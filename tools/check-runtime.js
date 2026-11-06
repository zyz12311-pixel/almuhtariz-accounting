const [major,minor]=process.versions.node.split('.').map(Number);
if(major<22||(major===22&&minor<13)){
  console.error('يتطلب المحترز Node.js 22.13 أو أحدث. الموجود: '+process.versions.node);
  process.exitCode=1;
}else{
  try{await import('node:sqlite');}catch{console.error('نسخة Node.js لا توفر SQLite المطلوب للتشغيل المحلي.');process.exitCode=1;}
}
