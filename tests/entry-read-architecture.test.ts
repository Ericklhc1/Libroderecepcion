import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';

const root='src';
const canonical='src/server/services/entry-visibility.ts';
const mutations=new Set(['create','createMany','createManyAndReturn','update','updateMany','updateManyAndReturn','upsert','delete','deleteMany']);
const engines:Record<string,string[]>={
  'src/server/services/alert-engine.ts':['alerts'],
  'src/server/ai/fronti-proactive.ts':['fronti'],
  'src/server/services/coordination.ts':['coordination'],
  'src/server/services/factory-reset.ts':['reset'],
  'src/server/services/incident-workflow.ts':['incident'],
  'src/server/services/operational-alarms.ts':['alarm'],
  'src/server/services/operational-automation.ts':['automation'],
  'src/server/services/subject-completion.ts':['lifecycle'],
  'src/server/services/work-notifications.ts':['stakeholders'],
  'src/server/ai/execution/revision.ts':['revision'],
};
function files(dir:string):string[]{return readdirSync(dir,{withFileTypes:true}).flatMap(item=>item.isDirectory()?files(join(dir,item.name)):/\.tsx?$/.test(item.name)?[join(dir,item.name)]:[]);}
export function entryReadViolations(code:string,file:string):string[]{
  if(file===canonical)return [];
  const ast=ts.createSourceFile(file,code,ts.ScriptTarget.Latest,true);
  const errors:string[]=[];
  const visit=(node:ts.Node)=>{
    if(ts.isPropertyAccessExpression(node)&&node.name.text==='operationalEntry'){
      const call=node.parent;
      if(ts.isPropertyAccessExpression(call)&&['create','createMany','createManyAndReturn','upsert'].includes(call.name.text)&&!['src/server/services/entries.ts','src/server/services/native-entry-creation.ts'].includes(file)){
        const invocation=call.parent;const argument=ts.isCallExpression(invocation)?invocation.arguments[0]:null;
        const data=argument&&ts.isObjectLiteralExpression(argument)?argument.properties.find(prop=>ts.isPropertyAssignment(prop)&&prop.name.getText(ast)==='data'):null;
        const type=data&&ts.isPropertyAssignment(data)&&ts.isObjectLiteralExpression(data.initializer)?data.initializer.properties.find(prop=>ts.isPropertyAssignment(prop)&&prop.name.getText(ast)==='type'):null;
        if(!type||!ts.isPropertyAssignment(type)||type.initializer.getText(ast)!=='EntryType.CAJA')errors.push('Creador de novedades fuera del helper de bloqueo/invalidation');
      }

      if(!ts.isPropertyAccessExpression(call)||!mutations.has(call.name.text)||!ts.isCallExpression(call.parent)||call.parent.expression!==call)errors.push('Acceso directo o alias a operationalEntry');
    }
    if(ts.isElementAccessExpression(node)&&node.argumentExpression&&ts.isStringLiteral(node.argumentExpression)&&node.argumentExpression.text==='operationalEntry')errors.push('Acceso indexado a operationalEntry');
    if(ts.isBindingElement(node)&& (node.propertyName?.getText(ast)==='operationalEntry'||node.name.getText(ast)==='operationalEntry'))errors.push('Alias desestructurado a operationalEntry');
    if(ts.isCallExpression(node)&&node.expression.getText(ast)==='readEntries'){
      const reader=node.arguments[1];
      if(reader&&ts.isObjectLiteralExpression(reader))for(const prop of reader.properties){
        if(ts.isPropertyAssignment(prop)&&prop.name.getText(ast)==='engine'){
          const value=ts.isStringLiteral(prop.initializer)?prop.initializer.text:'';
          if(!engines[file]?.includes(value))errors.push('Barrido interno fuera del motor autorizado');
        }
      }
    }
    if(ts.isCallExpression(node)&&/\$queryRawUnsafe$/.test(node.expression.getText(ast))&&node.arguments.some(arg=>/OperationalEntry/.test(arg.getText(ast))))errors.push('SQL inseguro de novedades fuera del helper');
    if(ts.isTaggedTemplateExpression(node)){
      const sql=node.template.getText(ast);
      if(/\b(?:FROM|JOIN)\s+"OperationalEntry"/i.test(sql)){
        const locking=/^`SELECT\s+(?:"id"|(?:e\.)?id)\s+FROM\s+"OperationalEntry"[\s\S]*FOR (?:UPDATE|SHARE)`$/i.test(sql);
        if(!locking&&!/entryReadSql\(/.test(sql))errors.push('SQL de novedades sin política central');
      }
    }
    ts.forEachChild(node,visit);
  };visit(ast);return errors;
}
describe('toda lectura de novedades usa la política central',()=>{
  it('no permite lecturas directas, alias, SQL ni barridos internos nuevos',()=>{
    const violations=files(root).flatMap(file=>entryReadViolations(readFileSync(file,'utf8'),file).map(error=>`${relative('.',file)}: ${error}`));
    expect(violations).toEqual([]);
  });
  it('el guardia falla con bypasses representativos aunque se renombre el cliente',()=>{
    const bypasses=['client.operationalEntry.create({data:{type:EntryType.INCIDENCIA}})','client.operationalEntry.findMany({})','const rows=client.operationalEntry; rows.count()','client["operationalEntry"].findUnique({})','const {operationalEntry: records}=client; records.findMany()','db.$queryRaw`SELECT title FROM "OperationalEntry"`','readEntries(db,{engine:"alerts"}).findMany()',`db.$queryRawUnsafe('SELECT title FROM "OperationalEntry"')`];
    for(const code of bypasses)expect(entryReadViolations(code,'src/app/example.tsx').length).toBeGreaterThan(0);
    expect(entryReadViolations('readEntries(db,user).findMany({where:{OR:[{title:"x"}]}})','src/app/example.tsx')).toEqual([]);
  });
});
