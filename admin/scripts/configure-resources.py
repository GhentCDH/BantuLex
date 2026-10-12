"""Apply BantuLex presentation choices to Crouton's generated resource JSON."""
import json,sqlite3,pathlib
root=pathlib.Path(__file__).resolve().parents[1]
c=sqlite3.connect(f'file:{root}/data/bantulex.db?mode=ro',uri=True)
groups={'lexical':'entry reflex blrentry reconstruction','sources':'source sourceentries','fieldwork':'fieldwork project collectionyear datacollector fieldworkdatacollector','geography':'coordinate location place region country','classifications':'variety blrcontributor blrreliability blrconsonantstructure blrvowelstructure blrtonestructure'}
labels={'entry':'Entries','reflex':'Reflexes','blrentry':'BLR entries','reconstruction':'Reconstructions','sourceentries':'Source entries','fieldworkdatacollector':'Fieldwork data collectors','blrconsonantstructure':'BLR consonant structures','blrvowelstructure':'BLR vowel structures','blrtonestructure':'BLR tone structures','blrcontributor':'BLR contributors','blrreliability':'BLR reliability','collectionyear':'Collection years','datacollector':'Data collectors','variety':'Varieties','country':'Countries'}
lookup={'entry':['term','translation'],'reflex':['term','translation'],'blrentry':['word','english'],'reconstruction':['word','english'],'source':['author_year','title'],'variety':['name_english','guthrie_index'],'fieldwork':['consultants','archive'],'location':['place_id','region_id','country_id'],'blrconsonantstructure':['cs','c1','c2'],'blrtonestructure':['t11','t12','t21'],'blrvowelstructure':['v11','v12','v21']}
inventory=[]
for (table,) in c.execute("select name from sqlite_master where type='table' and name not like 'sqlite_%' order by name"):
 p=root/'apps/backend/src/app/resources'/table/'resource.json'; r=json.loads(p.read_text())
 cols=c.execute(f'pragma table_info("{table}")').fetchall(); fks={x[3]:x[2] for x in c.execute(f'pragma foreign_key_list("{table}")')}
 r.update(title=labels.get(table,table.capitalize()+'s'),modalSize='xl',include=[],sidebar={'group':next(k for k,v in groups.items() if table in v.split()),'hide':False})
 r['columns']={}
 for _,name,typ,required,default,pk in cols:
  meta=name in ['id','created_at','updated_at']; long=name in ['notes','note','description','term_morph_analysis','meaning','title']
  col={'label':name.replace('_',' ').capitalize(),'type':{'type':[{'INTEGER':'integer','REAL':'number'}.get(typ,'string')]+([] if required or pk else ['null'])},'hiddenInView':False,'hiddenInForm':meta,'createable':not meta,'updateable':not meta,'sortable':True,'filterable':not long,'searchable':typ=='TEXT' and not meta,'hiddenInTable':name in ['created_at','updated_at'] or long,'showInLookup':typ=='TEXT' and name in lookup.get(table,['name','value'])}
  if name=='id': col.update(idField=True,defaultSort=True)
  if not meta:
   col['required']=bool(required and default is None)
   col['fieldInput']={'type':'textarea' if long else 'number' if typ in ('INTEGER','REAL') else 'string'}
  if name in fks:
   col['fieldInput']={'type':'autocomplete','relationType':'manyToOne','resource':f'../{fks[name]}/resource.json','options':{'valueKey':'id','labelKey':'display_label', 'storeValue':True,'resource':f'/{fks[name]}/schemas','enableCreate':False}}
   col['searchable']=False
   col['fieldView']={'type':'number','format':'number'}
   col['fieldTable']={'type':'number','format':'number'}
  r['columns'][name]=col
 if table=='fieldworkdatacollector':
  r['kind']='prisma'; r['idType']='string'
  r['columns']={'id':{'idField':True,'type':'string','hiddenInForm':True,'hiddenInTable':True,'createable':False,'updateable':False},**r['columns']}
  r['columns']['fieldwork_id']['defaultSort']=True
 if table!='fieldworkdatacollector':
  names=[x[1] for x in cols]
  keys=[k for k in lookup.get(table,['name','value']) if k in names]
  expr="SELECT '#' || main.id"+''.join(" || ' · ' || COALESCE(CAST(main.\""+k+"\" AS TEXT),'')" for k in keys)
  r['calculatedColumns']=[{'id':'display_label','alias':'display_label','label':'Reference','type':'string','sqlExpression':expr,'hiddenInTable':True,'hiddenInView':True}]
 if table=='coordinate':
  r['calculatedColumns'].append({'id': 'coordinate_map', 'alias': 'coordinate_map', 'label': 'Map', 'type': 'string', 'sqlExpression': "SELECT json_object('id', main.id, 'latitude', main.latitude, 'longitude', main.longitude, 'description', main.description)", 'hiddenInTable': True, 'hiddenInView': False, 'fieldInput': {'type': 'string', 'options': {'format': 'coordinate-map', 'colspan': 12}}})
 r['layout']={'form':{'type':'grid','columns':12,'controls':[{'id':k,'colspan':12 if k in ['notes','note','description','term_morph_analysis','meaning','title'] else 6} for k,v in r['columns'].items() if not v.get('hiddenInForm')]}}
 p.write_text(json.dumps(r,indent=2)+'\n')
 inventory.append({'table':table,'columns':[{'name':x[1],'type':x[2],'required':bool(x[3]),'pk':x[5]} for x in cols],'foreignKeys':fks,'rows':c.execute(f'select count(*) from "{table}"').fetchone()[0]})
(root/'tests/inventory.json').write_text(json.dumps(inventory,indent=2)+'\n')
p=root/'crouton.json';r=json.loads(p.read_text());r['autoSave']=False;p.write_text(json.dumps(r,indent=2)+'\n')
