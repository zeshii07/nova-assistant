const fs=require('fs');const path=require('path');
class LocalJsonFile{
 constructor(filePath,initial={}){this.filePath=filePath;this.initial=initial;}
 read(){
  if(!this.filePath||!fs.existsSync(this.filePath))return structuredClone(this.initial);
  try{return JSON.parse(fs.readFileSync(this.filePath,'utf8'));}catch{return structuredClone(this.initial);}
 }
 write(value){
  if(!this.filePath)return value;
  fs.mkdirSync(path.dirname(this.filePath),{recursive:true});
  const tmp=`${this.filePath}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
  fs.writeFileSync(tmp,JSON.stringify(value,null,2)+'\n');
  fs.renameSync(tmp,this.filePath);
  return value;
 }
 clear(){if(this.filePath&&fs.existsSync(this.filePath))fs.rmSync(this.filePath,{force:true});}
}
module.exports={LocalJsonFile};
