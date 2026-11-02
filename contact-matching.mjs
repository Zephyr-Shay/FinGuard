const label=x=>typeof x==='string'?x.normalize('NFKC').trim():'';
export function resolveContact(input,contacts=[]){
 const value=label(input),names=contacts.filter(c=>value&&label(c.name)===value);
 if(names.length)return {kind:'name',matches:names};
 return {kind:'alias',matches:contacts.filter(c=>value&&label(c.alias)===value)};
}
export function contactLabels(contacts=[]){
 const names=new Map();
 for(const c of contacts){const name=label(c.name);if(name){const ids=names.get(name)||new Set();ids.add(c.id);names.set(name,ids);}}
 const fullNames=new Set(names.keys());
 for(const c of contacts){const alias=label(c.alias);if(alias&&!fullNames.has(alias)){const ids=names.get(alias)||new Set();ids.add(c.id);names.set(alias,ids);}}
 return names;
}
