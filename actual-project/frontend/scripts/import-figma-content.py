"""Import reviewed design content, not executable instructions, from the handoff."""
import json, re, pathlib, urllib.parse, argparse

parser = argparse.ArgumentParser(description='Import the team Figma handoff content.')
parser.add_argument('bundle', type=pathlib.Path)
parser.add_argument('--audit-dir', type=pathlib.Path)
args = parser.parse_args()
FRONT = pathlib.Path(__file__).resolve().parents[1]
BUNDLE = args.bundle.resolve()
ROOT = args.audit_dir or FRONT / '.figma-import'
ROOT.mkdir(parents=True, exist_ok=True)
OUT = FRONT / 'src/content'
OUT.mkdir(exist_ok=True)
def slug(s): return re.sub(r'[^a-z0-9]+', '-', s.lower()).strip('-')
frames=[]
for path in sorted((BUNDLE/'specs/raw').glob('*.json')):
    data=json.loads(path.read_text(encoding='utf-8'))
    for frame in (data if isinstance(data,list) else data['frames']):
        frame={**frame,'section':path.stem}
        frames.append(frame)
def texts(f): return [str(x[2]) for x in f.get('texts',[])]
def external(f):
    return [{'label':l['el'], 'url':l['do'][5:]} for l in f.get('links',[]) if l['do'].startswith(('open https://','open http://'))]

# The original credit/source stays alongside every downloadable asset.
photos=[]
credit_frame=next(f for f in frames if f['name']=='Photo credits · coastal images')
credit_texts=texts(credit_frame)
credit_names={item['label'].removeprefix('Source · ') for item in external(credit_frame)}
for item in external(credit_frame):
    name=item['label'].removeprefix('Source · ')
    index=credit_texts.index(name) if name in credit_texts else -1
    credit_parts=[]
    if index>=0:
        for line in credit_texts[index+1:]:
            if line in credit_names or line=='Done': break
            credit_parts.append(line)
    credit=' · '.join(credit_parts)
    photos.append({'name':name,'source':item['url'],'credit':credit})
for f in frames:
    if f['name'].startswith('Beach · '):
        source=next((x['url'] for x in external(f) if 'Photo' in x['label']),None)
        if source: photos.append({'name':f['name'].split(' · ')[1],'source':source,'credit':next((t for t in texts(f) if t.startswith('Photo · ')),'')})
unique={}
for p in photos:
    if p['name'] not in unique or '/wiki/File:' in p['source']: unique[p['name']]=p
photos=list(unique.values())
downloads={}
for p in photos:
    p['image']=None
    if 'commons.wikimedia.org/wiki/File:' in p['source']:
        filename=urllib.parse.unquote(p['source'].split('/wiki/File:',1)[1])
        ext=pathlib.Path(filename).suffix.lower()
        if ext not in ('.jpg','.jpeg','.png','.webp'): continue
        dest='public/images/coastal/'+slug(p['name'])+ext
        url='https://commons.wikimedia.org/wiki/Special:FilePath/'+urllib.parse.quote(filename)+'?width=900'
        downloads[dest]=url
        asset=FRONT/dest
        if asset.exists() and asset.stat().st_size>1000: p['image']='/'+dest.removeprefix('public/')
aliases={'Green Sea Turtle':'Green turtle','Mangrove Crabs':'Crabs · species vary','Black Sea Cucumber':'Black long sea cucumber','Faunus Snail':'Black faunus snail','Corals':'Coral reef','Coastal Shellfish':'Blood cockle','Mangroves':'Rhizophora mucronata','Seagrass':'Seagrass illustration','Sea Turtles':'Green turtle','Clownfish':'Ocellaris clownfish','Hawksbill Turtle':'Hawksbill turtle'}
existing={'Green Sea Turtle':'/species/green-sea-turtle.jpg','Irrawaddy Dolphin':'/species/irrawaddy-dolphin.jpg','Moorish Idol':'/species/moorish-idol.jpg','Ocellaris Clownfish':'/species/ocellaris-clownfish.jpg'}
# Verified non-Commons photos from the prototype's own source links.
# The worm asset is the unmodified embedded Figure 1 image, PDF page 2.
source_assets={
    'https://www.usgs.gov/media/images/mangrove-crab': ('/images/coastal/mangrove-crab-usgs.jpg', 'Tracy Enright, U.S. Geological Survey · Public Domain'),
    'https://ejournal.undip.ac.id/index.php/ijms/article/view/60038': ('/images/coastal/tube-dwelling-worm.jpg', 'Wibowo et al. (2025), Figure 1 · CC BY-SA 4.0'),
}
for photo in photos:
    if photo['source'] in source_assets:
        asset,credit=source_assets[photo['source']]
        if (FRONT/'public'/asset.lstrip('/')).is_file():
            photo.update(image=asset,credit=credit)
species=[]
for f in frames:
    if not f['name'].startswith(('H20 ','H20+ ','H20b ','H20c ','H20d ')): continue
    ts=texts(f)
    top=[x[2] for x in f['texts'] if 230<=x[0]<450 and x[1]==20]
    if len(top)<3: continue
    name,subtitle,intro=top[:3]
    answers=[]
    for title in ['Where It Lives','Litter Impact','What You Can Do']:
        i=ts.index(title) if title in ts else -1
        answers.append({'title':title,'text':ts[i+1] if i>=0 else ''})
    sources=external(f)
    source_labels=[t for t in ts if '↗' in t]
    for i,s in enumerate(sources): s['label']=source_labels[i].replace(' ↗','') if i<len(source_labels) else s['label']
    key=aliases.get(name,name)
    photo=next((p for p in photos if p['name'].lower()==key.lower() or p['name'].lower()==subtitle.lower()),None)
    category='plant' if any(x in (name+' '+subtitle).lower() for x in ['rhizophora','nypa','bruguiera','enhalus','halophila','thalassia','halodule','syringodium']) or name.lower() in ('mangroves','seagrass') else 'animal'
    species.append({'id':slug(name),'figmaId':f['id'],'name':name,'subtitle':subtitle,'intro':intro,'evidence':next((t for t in ts if 'not a live sighting' in t or 'not a local sighting' in t),'From published sources · not a live sighting'),'answers':answers,'sources':sources,'credit':next((t for t in ts if t.startswith('Photo · ')),''),'image':existing.get(name) or (photo['image'] if photo else None),'photoSource':photo['source'] if photo else None,'category':category})
species.sort(key=lambda s: 0 if s['name']=='Green Sea Turtle' else 1)

# Keep verified local media when the design handoff lacks a download/link.
# This also keeps list, detail, region cards and photo credits on the same asset.
overrides_path = OUT / 'speciesPhotoOverrides.json'
overrides = json.loads(overrides_path.read_text(encoding='utf-8')) if overrides_path.exists() else {}
for species_item in species:
    media = overrides.get(species_item['id'])
    if not media or not (FRONT / 'public' / media['image'].lstrip('/')).is_file():
        continue
    species_item.update({key: media[key] for key in ('image', 'photoSource', 'credit')})
    if species_item['id'] == 'indo-pacific-finless-porpoise':
        for source in species_item['sources']:
            if 'commons.wikimedia.org' in source['url']:
                source['url'] = media['photoSource']
    photo = next((p for p in photos if p['name'] == species_item['name']), None)
    if photo is None:
        photo = {'name': species_item['name']}
        photos.append(photo)
    photo.update(image=media['image'], source=media['photoSource'], credit=media['credit'])

beaches=[]
pilot_ids={'Pantai Morib':'morib','Pantai Bagan Lalang':'bagan','Pantai Remis':'remis','Pantai Kelanang':'kelanang'}
for f in frames:
    if not f['name'].startswith('Beach · '): continue
    ts=texts(f); name=f['name'].split(' · ')[1]
    area=next((t.removesuffix(' · Malaysia') for t in ts if t.endswith(' · Malaysia')),'Malaysia')
    links=' '.join(l['do'] for l in f['links'])
    m=re.search(r'biodiversity/region="([^"]+)"',links); region=m.group(1) if m else 'selangor'
    count=next((int(re.match(r'(\d+) counted report',t).group(1)) for t in ts if re.match(r'\d+ counted report',t)),0)
    band=next((t.title() for t in ts if t in ['LOW','MODERATE','HIGH','SEVERE']),None)
    targets=[]
    for l in f['links']:
        if 'Marine card' in l['el'] or 'Local record introduction' in l['el']:
            target=re.search(r'go H20[^·]* · ([^·]+) ·',l['do'])
            if target:
                candidate=target.group(1).strip()
                s=next((s for s in species if s['name'].lower()==candidate.lower()),None)
                if s and s['id'] not in targets: targets.append(s['id'])
    photo=next((p for p in photos if p['name']==name),None)
    image='/home/pantai-morib.jpg' if name=='Pantai Morib' else (photo['image'] if photo else None)
    beaches.append({'id':pilot_ids.get(name,slug(name)),'figmaId':f['id'],'name':name,'area':area,'region':region,'severity':band,'validReports':count,'reported':next((t for t in ts if re.match(r'Reported \d+ days ago',t)),'Not recently reported'),'image':image,'photoSource':photo['source'] if photo else None,'credit':photo['credit'] if photo else next((t for t in ts if t.startswith('Photo · ')),''), 'species':targets,'habitat':next((t.removeprefix('Habitat · ') for t in ts if t.startswith('Habitat · ')),None)})

habitats=[]
for f in frames:
    if not f['name'].startswith('Habitat detail · '): continue
    ts=texts(f); name=f['name'].split(' · ')[1]
    head=[x[2] for x in f['texts'] if 300<=x[0]<460 and x[1]==40]
    species_ids=[]
    for l in f['links']:
        m=re.search(r'go H20[^·]* · ([^·]+) ·',l['do'])
        if m:
            s=next((s for s in species if s['name'].lower()==m.group(1).strip().lower()),None)
            if s and s['id'] not in species_ids:species_ids.append(s['id'])
    habitats.append({'id':slug(name),'figmaId':f['id'],'title':head[1] if len(head)>1 else name,'area':head[0] if head else name,'intro':head[2] if len(head)>2 else '', 'species':species_ids,'sources':external(f),'texts':ts})

regions=[]
region_ids=['north','perak','selangor','nsm','johor','kelantan','tganu','pahang','borneo']
for f in frames:
    if not (f['name'].startswith('Biodiversity · ') and f['name'].endswith(' · species and impact')):continue
    records=[];ts=f['texts'];consumed=set()
    for i,t in enumerate(ts):
        if i not in consumed and t[1]==33 and i+2<len(ts) and ts[i+1][1]==33 and ts[i+2][1]==33 and ts[i+1][0]-t[0] in (20,22,24):
            consumed.update([i+1,i+2])
            name=t[2]; rec={'name':name,'place':ts[i+1][2],'description':ts[i+2][2]}
            s=next((s for s in species if s['name'].lower()==name.lower() or s['name'].lower()=={'green turtle':'green sea turtle','coral restoration':'corals'}.get(name.lower(),'')),None)
            rec['speciesId']=s['id'] if s else None
            rec['image']=s['image'] if s else None
            records.append(rec)
    regions.append({'id':region_ids[len(regions)],'figmaId':f['id'],'name':f['name'].split(' · ')[1].title(),'records':records,'sources':external(f)})

result={'species':species,'beaches':beaches,'habitats':habitats,'regions':regions,'photos':photos}
(OUT/'coastalContent.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
(ROOT/'frame_inventory.json').write_text(json.dumps(frames,ensure_ascii=False,indent=2),encoding='utf-8')
cfg=['parallel','parallel-max = 4']
for dest,url in downloads.items():
    if (FRONT/dest).exists() and (FRONT/dest).stat().st_size>1000:continue
    cfg += ['location','fail','connect-timeout = 12','max-time = 45','user-agent = "RadarPantaiPrototype/1.0"','url = '+json.dumps(url),'output = '+json.dumps(dest),'next']
if cfg[-1]=='next':cfg.pop()
(ROOT/'photo-downloads.txt').write_text('\n'.join(cfg),encoding='utf-8')
print(json.dumps({'frames':len(frames),'species':len(species),'beaches':len(beaches),'habitats':len(habitats),'regions':len(regions),'photo_downloads':len(downloads)},ensure_ascii=False))
