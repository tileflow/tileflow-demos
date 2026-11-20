import {cellAt,GRID} from './grid.js';

export const media=['Feature film','TV series','TV film','Web series'];
export const fold=s=>s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('en').replace(/[^\p{L}\p{N}]+/gu,' ').trim();

export class FilmArchive {
  constructor(source){
    this.titles=source.titles;this.addresses=source.addresses;
    this.names=this.titles.map(([title])=>fold(title));
    this.records=source.records.map(([title,year,x,y,address])=>{
      const lon=x/1e6,lat=y/1e6,[q,r]=cellAt(lon,lat);
      return {title,year,lon,lat,q,r,key:q+','+r,address};
    });
    this.years=[...new Set(this.records.map(row=>row.year))].sort((a,b)=>b-a);
    this.total=this.records.length;
  }
  select(year,phrase,work=null){
    const term=fold(phrase);
    const cells=new Map(),texels=new Uint8Array(GRID*GRID*2);
    let total=0, west=Infinity,east=-Infinity,south=Infinity,north=-Infinity;
    for(const row of this.records){
      if((year && row.year!==year) || (work!==null && row.title!==work) || (term && !this.names[row.title].includes(term)))continue;
      let c=cells.get(row.key);
      if(!c){c={q:row.q,r:row.r,film:0,tv:0,records:[]};cells.set(row.key,c);}
      if(this.titles[row.title][1]===0)c.film++;else c.tv++;
      c.records.push(row);total++;
      west=Math.min(west,row.lon);east=Math.max(east,row.lon);south=Math.min(south,row.lat);north=Math.max(north,row.lat);
    }
    for(const {q,r,film,tv} of cells.values()){
      const i=((r+GRID/2)*GRID+q+GRID/2)*2,n=film+tv;
      const intensity = term || work!==null
        ? .61+.39*Math.min(1,Math.log1p(n)/Math.log(8))
        : Math.min(1,.13+.87*Math.log1p(n)/Math.log(1+(year?9:38)));
      texels[i]=Math.round(255*film/n);texels[i+1]=Math.round(255*intensity);
    }
    return {cells,texels,total,bounds:total?[[west,south],[east,north]]:null};
  }
  matches(text,year){
    const query=fold(text),counts=new Map();
    for(const row of this.records)if((!year || row.year===year) && this.names[row.title].includes(query))counts.set(row.title,(counts.get(row.title)||0)+1);
    return [...counts.entries()].sort((a,b)=>b[1]-a[1]||this.titles[a[0]][0].localeCompare(this.titles[b[0]][0])).slice(0,12);
  }
}
