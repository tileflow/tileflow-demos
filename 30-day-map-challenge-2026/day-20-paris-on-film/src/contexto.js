// Keep the compiled Tileflow Streets hierarchy while printing it in pearl and graphite.
const root=new URL(import.meta.env.BASE_URL,location.origin).href.replace(/\/$/,'');

const atCityScale=(city,street)=>['interpolate',['linear'],['zoom'],12.9,city,14.55,street];

export function atlasStyle(previous,spec){
  const labels=[],paper=[];
  for(const layer of spec.layers){
    if(layer.type==='background'){paper.push({...layer,paint:{'background-color':'#faf9f5'}});continue;}
    if(layer.source!=='tileflow' || layer.id.includes('bathymetry') || layer.id.includes('landcover-protected'))continue;
    const l={...layer,paint:{...layer.paint}};
    if(l.type==='symbol'){
      const place=/tileflow-label-place-(country|state|city|town|village)$/.test(l.id);
      const road=/tileflow-label-road-(major|secondary|tertiary|minor)$/.test(l.id);
      if(!road && !place)continue;
      if(road)l.minzoom=Math.max(l.minzoom||0,l.id.endsWith('minor')?16.85:l.id.endsWith('tertiary')?16.4:15.5);
      if(place)l.maxzoom=Math.min(l.maxzoom||24,12.9);
      l.layout={...l.layout,'text-font':['Noto Sans Regular'],'text-field':['coalesce',['get','name_en'],['get','name'],['get','name_en']]};
      l.paint={...l.paint,'text-color':place?'#575563':'#777181','text-halo-color':'#faf9f6','text-halo-width':1.5};
      if(road){
        l.layout['symbol-spacing']=440;
        l.layout['text-size']=['interpolate',['linear'],['zoom'],15,10,18,12];
        l.paint['text-halo-width']=1.05;
      }
      labels.push(l);continue;
    }
    if(l.type==='fill'){
      const source=l['source-layer'];
      const color=source==='water'?atCityScale('#b5cbd1','#d6e1e5'):source==='landcover'?['match',['get','class'],'trees','#e8ece4','urban','#efebed','#f4f3ed']:
        source==='landuse'?['match',['get','class'],['park','wood','garden','forest'],'#e7ebe2','residential','#eeeced','#f2f0eb']:'#edeae6';
      delete l.paint['fill-pattern'];l.paint['fill-color']=color;l.paint['fill-outline-color']=color;
    }else if(l.type==='line'){
      const source=l['source-layer'];
      const street=source==='admin'?'#c0bac4':source==='waterway'?'#c2d5da':l.id.includes('casing')?'#d7d3d7':l.id.includes('path')?'#dedbd9':'#d9d6d7';
      const city=source==='waterway'?'#a7c4ca':source==='admin'?'#aaa2ae':l.id.includes('casing')?'#b6aeb4':l.id.includes('path')?'#cfcac2':'#c6bfc2';
      l.paint['line-color']=atCityScale(city,street);
    }else continue;
    paper.push(l);
  }
  paper.push({id:'atlas-edificios',type:'fill',source:'tileflow','source-layer':'building',minzoom:13.2,
    paint:{'fill-color':'#eceae9','fill-outline-color':'#dcd9db','fill-opacity':.9}});
  const {terrain,sky,...style}=spec;
  return {...style,glyphs:root+'/fuentes/{fontstack}/{range}.pbf',sources:{
    tileflow:{type:'vector',tiles:[root+'/atlas/{z}/{x}/{y}.pbf'],minzoom:2,maxzoom:14,attribution:spec.sources.tileflow.attribution}
  },layers:[...paper,...labels]};
}
export function tileRequest(url,index){
  const match=url.match(/\/atlas\/(\d+)\/(\d+)\/(\d+)\.pbf/);
  if(match){
    const [,z,x,y]=match.map(Number),r=index.ranges[z];
    if(r && x>=r[0] && x<=r[2] && y>=r[1] && y<=r[3])return {url:root+'/datos/teselas/'+z+'/'+x+'-'+y+'.pbf'};
    return {url:index.template.replace('{z}',z).replace('{x}',x).replace('{y}',y)};
  }
  if(url.includes('/tiles/world/tiles.json'))return {url:root+'/datos/world.json'};
  const glyph=url.match(/\/fuentes\/[^/]+\/(\d+)-(\d+)\.pbf/);
  if(glyph){const local=[0,256,8192].includes(Number(glyph[1]));
    return {url:local?root+'/fuentes/'+glyph[1]+'-'+glyph[2]+'.pbf':
      'https://api.tileflow.dev/base/fe873949787f8f1e2ff72853d13c1e6e3c1de83474e4c1de60dae6ac33fe3081/glyphs/Noto%20Sans%20Regular/'+glyph[1]+'-'+glyph[2]+'.pbf'};}
  return {url};
}
