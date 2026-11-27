import java.io.ByteArrayInputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.cert.CertificateFactory;
import java.security.cert.X509Certificate;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Base64;
import java.util.List;
import javax.xml.XMLConstants;
import javax.xml.crypto.dsig.Reference;
import javax.xml.crypto.dsig.XMLSignature;
import javax.xml.crypto.dsig.XMLSignatureFactory;
import javax.xml.crypto.dsig.dom.DOMValidateContext;
import javax.xml.parsers.DocumentBuilderFactory;
import org.apache.xml.security.Init;
import org.apache.xml.security.c14n.Canonicalizer;
import org.w3c.dom.Document;
import org.w3c.dom.Element;
import org.w3c.dom.NodeList;
import javax.xml.transform.TransformerFactory;
import javax.xml.transform.dom.DOMSource;
import javax.xml.transform.stream.StreamResult;
import java.io.ByteArrayOutputStream;

public final class VerifyXades {
  private static final String DS = "http://www.w3.org/2000/09/xmldsig#";

  private VerifyXades() {}

  private static Document parse(byte[] xml) throws Exception {
    DocumentBuilderFactory factory = DocumentBuilderFactory.newInstance();
    factory.setNamespaceAware(true);
    factory.setFeature(XMLConstants.FEATURE_SECURE_PROCESSING, true);
    factory.setFeature("http://apache.org/xml/features/disallow-doctype-decl", true);
    factory.setFeature("http://xml.org/sax/features/external-general-entities", false);
    factory.setFeature("http://xml.org/sax/features/external-parameter-entities", false);
    factory.setXIncludeAware(false);
    factory.setExpandEntityReferences(false);
    factory.setAttribute(XMLConstants.ACCESS_EXTERNAL_DTD, "");
    factory.setAttribute(XMLConstants.ACCESS_EXTERNAL_SCHEMA, "");
    return factory.newDocumentBuilder().parse(new ByteArrayInputStream(xml));
  }

  private static X509Certificate certificate(Element signature) throws Exception {
    NodeList certificates = signature.getElementsByTagNameNS(DS, "X509Certificate");
    if (certificates.getLength() != 1) throw new IllegalArgumentException("Expected exactly one embedded signing certificate");
    byte[] der = Base64.getMimeDecoder().decode(certificates.item(0).getTextContent());
    return (X509Certificate) CertificateFactory.getInstance("X.509")
        .generateCertificate(new ByteArrayInputStream(der));
  }

  public static void main(String[] args) throws Exception {
    if (args.length != 1) throw new IllegalArgumentException("Usage: VerifyXades.java signed-invoice.xml");
    Init.init();
    Document document = parse(Files.readAllBytes(Path.of(args[0])));
    NodeList signatures = document.getElementsByTagNameNS(DS, "Signature");
    if (signatures.getLength() != 1) throw new IllegalArgumentException("Expected exactly one XML Signature");

    Element signatureElement = (Element) signatures.item(0);
    X509Certificate certificate = certificate(signatureElement);
    DOMValidateContext context = new DOMValidateContext(certificate.getPublicKey(), signatureElement);
    context.setProperty("org.jcp.xml.dsig.secureValidation", Boolean.TRUE);
    NodeList signatureIds = document.getElementsByTagNameNS(DS, "Signature");
    if (signatureIds.getLength() == 1) {
      Element signature = (Element) signatureIds.item(0);
      if (signature.hasAttribute("Id")) context.setIdAttributeNS(signature, null, "Id");
    }

    NodeList signedProperties = signatureElement.getElementsByTagNameNS("http://uri.etsi.org/01903/v1.3.2#", "SignedProperties");
    if (signedProperties.getLength() != 1) throw new IllegalArgumentException("Expected exactly one XAdES SignedProperties element");
    context.setIdAttributeNS((Element) signedProperties.item(0), null, "Id");

    XMLSignature xmlSignature = XMLSignatureFactory.getInstance("DOM").unmarshalXMLSignature(context);
    NodeList signedInfoNodes = signatureElement.getElementsByTagNameNS(DS, "SignedInfo");
    if (signedInfoNodes.getLength() != 1) throw new IllegalArgumentException("Expected exactly one SignedInfo element");
    Element signedInfoElement = (Element) signedInfoNodes.item(0);
    Canonicalizer signedInfoCanonicalizer = Canonicalizer.getInstance(Canonicalizer.ALGO_ID_C14N11_OMIT_COMMENTS);
    signedInfoCanonicalizer.setSecureValidation(true);
    byte[] signedInfoCanonical = signedInfoCanonicalizer.canonicalizeSubtree(signedInfoElement);
    byte[] signedInfoCanonicalSha256 = MessageDigest.getInstance("SHA-256").digest(signedInfoCanonical);
    NodeList signatureValues = signatureElement.getElementsByTagNameNS(DS, "SignatureValue");
    if (signatureValues.getLength() != 1) throw new IllegalArgumentException("Expected exactly one SignatureValue");
    byte[] signatureBytes = Base64.getMimeDecoder().decode(signatureValues.item(0).getTextContent());
    java.security.Signature verifier = java.security.Signature.getInstance("SHA256withECDSA");
    verifier.initVerify(certificate.getPublicKey());
    verifier.update(signedInfoCanonical);
    boolean signatureValueValid = verifier.verify(signatureBytes);
    boolean referencesValid = true;
    List<String> referenceResults = new ArrayList<>();
    for (Object value : xmlSignature.getSignedInfo().getReferences()) {
      Reference reference = (Reference) value;
      if (!"".equals(reference.getURI()) && !"#xadesSignedProperties".equals(reference.getURI())) {
        throw new IllegalArgumentException("External or unexpected XMLDSig reference is not allowed");
      }
      boolean referenceValid;
      if ("#xadesSignedProperties".equals(reference.getURI())) {
        Element signedPropertiesElement = (Element) signedProperties.item(0);
        Canonicalizer canonicalizer = Canonicalizer.getInstance(Canonicalizer.ALGO_ID_C14N11_OMIT_COMMENTS);
        canonicalizer.setSecureValidation(true);
        byte[] canonical = canonicalizer.canonicalizeSubtree(signedPropertiesElement);
        byte[] calculated = MessageDigest.getInstance("SHA-256").digest(canonical);
        byte[] expected = reference.getDigestValue();
        referenceValid = java.util.Arrays.equals(expected, calculated);
        referencesValid &= referenceValid;
        referenceResults.add("{\"uri\":\"" + reference.getURI() + "\",\"valid\":" + referenceValid +
          ",\"expectedDigest\":\"" + Base64.getEncoder().encodeToString(expected) +
          "\",\"calculatedDigest\":\"" + Base64.getEncoder().encodeToString(calculated) + "\"}");
        continue;
      }
      referenceValid = reference.validate(context);
      referencesValid &= referenceValid;
      referenceResults.add("{\"uri\":\"" + reference.getURI() + "\",\"valid\":" + referenceValid +
          ",\"expectedDigest\":\"" + Base64.getEncoder().encodeToString(reference.getDigestValue()) +
          "\",\"calculatedDigest\":\"" + Base64.getEncoder().encodeToString(reference.getCalculatedDigestValue()) + "\"}");
    }
    boolean valid = signatureValueValid && referencesValid;
    System.out.println("{\"signatureValueValid\":" + signatureValueValid +
        ",\"signedInfoCanonicalSha256\":\"" + Base64.getEncoder().encodeToString(signedInfoCanonicalSha256) + "\"" +
        ",\"referencesValid\":" + referencesValid + ",\"references\":[" +
        String.join(",", referenceResults) + "],\"valid\":" + valid + "}");
    if (!valid) System.exit(1);
  }
}
