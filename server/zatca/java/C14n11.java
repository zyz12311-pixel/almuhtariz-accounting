import java.io.ByteArrayInputStream;
import java.io.OutputStream;
import javax.xml.XMLConstants;
import javax.xml.parsers.DocumentBuilderFactory;
import org.apache.xml.security.Init;
import org.apache.xml.security.c14n.Canonicalizer;
import org.w3c.dom.Document;
import org.w3c.dom.Element;
import org.w3c.dom.Node;
import org.w3c.dom.NodeList;

public final class C14n11 {
  private static final String UBL_EXT = "urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2";
  private static final String UBL_CAC = "urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2";
  private static final String UBL_CBC = "urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2";
  private static final String UBL_INVOICE = "urn:oasis:names:specification:ubl:schema:xsd:Invoice-2";

  private C14n11() {}

  private static Document parseInvoice(byte[] xml) throws Exception {
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
    Document document = factory.newDocumentBuilder().parse(new ByteArrayInputStream(xml));
    Element root = document.getDocumentElement();
    if (!"Invoice".equals(root.getLocalName()) || !UBL_INVOICE.equals(root.getNamespaceURI())) {
      throw new IllegalArgumentException("Expected a UBL Invoice document");
    }
    return document;
  }

  private static void removeElements(Document document, String namespace, String localName) {
    NodeList elements = document.getElementsByTagNameNS(namespace, localName);
    for (int index = elements.getLength() - 1; index >= 0; index--) {
      Node element = elements.item(index);
      element.getParentNode().removeChild(element);
    }
  }

  private static boolean isQrReference(Element reference) {
    for (Node child = reference.getFirstChild(); child != null; child = child.getNextSibling()) {
      if (child instanceof Element) {
        Element element = (Element) child;
        if (UBL_CBC.equals(element.getNamespaceURI()) &&
            "ID".equals(element.getLocalName()) &&
            "QR".equals(element.getTextContent().trim())) {
          return true;
        }
      }
    }
    return false;
  }

  private static void removeQrReferences(Document document) {
    NodeList references = document.getElementsByTagNameNS(UBL_CAC, "AdditionalDocumentReference");
    for (int index = references.getLength() - 1; index >= 0; index--) {
      Element reference = (Element) references.item(index);
      if (isQrReference(reference)) reference.getParentNode().removeChild(reference);
    }
  }

  public static void main(String[] args) throws Exception {
    if (args.length != 1 ||
        (!"invoice".equals(args[0]) && !"subtree".equals(args[0]) &&
        !"signedinfo".equals(args[0]) && !"signedproperties".equals(args[0]) &&
        !"signedinfo-document".equals(args[0]) && !"signedproperties-document".equals(args[0]))) {
      throw new IllegalArgumentException("Usage: C14n11 (invoice|subtree|signedinfo|signedproperties|signedinfo-document|signedproperties-document)");
    }
    byte[] xml = System.in.readAllBytes();
    if (xml.length == 0) throw new IllegalArgumentException("Invoice XML input is empty");

    Init.init();
    Document document;
    if ("invoice".equals(args[0])) {
      document = parseInvoice(xml);
      removeElements(document, UBL_EXT, "UBLExtensions");
      removeElements(document, UBL_CAC, "Signature");
      removeQrReferences(document);
    } else if ("signedinfo-document".equals(args[0]) || "signedproperties-document".equals(args[0])) {
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
      document = factory.newDocumentBuilder().parse(new ByteArrayInputStream(xml));
      Element target;
      if ("signedinfo-document".equals(args[0])) {
        NodeList nodes = document.getElementsByTagNameNS("http://www.w3.org/2000/09/xmldsig#", "SignedInfo");
        if (nodes.getLength() != 1) throw new IllegalArgumentException("Expected exactly one SignedInfo");
        target = (Element) nodes.item(0);
      } else {
        NodeList nodes = document.getElementsByTagNameNS("http://uri.etsi.org/01903/v1.3.2#", "SignedProperties");
        if (nodes.getLength() != 1) throw new IllegalArgumentException("Expected exactly one SignedProperties");
        target = (Element) nodes.item(0);
      }
      Canonicalizer canonicalizer = Canonicalizer.getInstance(Canonicalizer.ALGO_ID_C14N11_OMIT_COMMENTS);
      canonicalizer.setSecureValidation(true);
      byte[] canonicalXml = canonicalizer.canonicalizeSubtree(target);
      OutputStream output = System.out;
      output.write(canonicalXml);
      output.flush();
      return;
    } else if ("signedinfo".equals(args[0]) || "signedproperties".equals(args[0])) {
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
      document = factory.newDocumentBuilder().parse(new ByteArrayInputStream(xml));
      Element target;
      if ("signedinfo".equals(args[0])) {
        NodeList nodes = document.getElementsByTagNameNS("http://www.w3.org/2000/09/xmldsig#", "SignedInfo");
        if (nodes.getLength() != 1) throw new IllegalArgumentException("Expected exactly one SignedInfo");
        target = (Element) nodes.item(0);
      } else {
        NodeList nodes = document.getElementsByTagNameNS("http://uri.etsi.org/01903/v1.3.2#", "SignedProperties");
        if (nodes.getLength() != 1) throw new IllegalArgumentException("Expected exactly one SignedProperties");
        target = (Element) nodes.item(0);
      }
      Canonicalizer canonicalizer = Canonicalizer.getInstance(Canonicalizer.ALGO_ID_C14N11_OMIT_COMMENTS);
      canonicalizer.setSecureValidation(true);
      byte[] canonicalXml = canonicalizer.canonicalizeSubtree(target);
      OutputStream output = System.out;
      output.write(canonicalXml);
      output.flush();
      return;
    } else {
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
      document = factory.newDocumentBuilder().parse(new ByteArrayInputStream(xml));
    }

    Canonicalizer canonicalizer = Canonicalizer.getInstance(Canonicalizer.ALGO_ID_C14N11_OMIT_COMMENTS);
    canonicalizer.setSecureValidation(true);
    byte[] canonicalXml = canonicalizer.canonicalizeSubtree(document);
    OutputStream output = System.out;
    output.write(canonicalXml);
    output.flush();
  }
}
