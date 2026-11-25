const mapping={
  admin:'boundary',place_label:'place',road:'transportation',road_label:'transportation_name',
  road_shield:'transportation_name',sidewalk:'transportation',aeroway:'aeroway',building:'building',
  housenum_label:'housenumber',water:'water',waterway:'waterway',water_label:'water_name',water_name:'water_name',
  natural_label:'natural_label',poi_label:'poi',landuse:'landuse',landuse_overlay:'landuse',landcover:'landcover'
};
const waterNames=new Set(['ocean','sea','lake','reservoir','bay','strait','river','stream','canal','water','gulf','waterfall','fjord','lagoon']);
const parks=new Set(['park','national_park','nature_reserve','protected_area','recreation_ground','garden','village_green']);
export const layers=Object.keys(mapping);
export function normalizeProperties(layer,p,tileKey,id) {
  let output=mapping[layer], clazz=p.class??layer,subclass=p.type??p.subclass??p.class;
  if (layer==='natural_label' && waterNames.has(clazz)) output='water_name';
  if ((layer==='landuse' || layer==='landuse_overlay') && (parks.has(clazz) || parks.has(p.type))) output='park';
  if (layer==='road' || layer==='road_label' || layer==='road_shield') {
    if (clazz==='street' || clazz==='street_limited') clazz='minor';
  } else if (layer==='sidewalk') {clazz='path';subclass='sidewalk';}
  else if (layer==='place_label' && ['settlement','settlement_subdivision'].includes(clazz)) clazz=p.type??clazz;
  const result={_layer:output,_class:p.class??'',_tile:tileKey,class:clazz};
  if (subclass!==undefined) result.subclass=subclass;
  if (id!==undefined) result.id=id;
  for (const key of ['name','name_en','name_latin','name_es','ref','rank','admin_level','maritime','disputed','capital','iso_3166_1','height','use','type','oneway','structure','surface','house_num','network','link','shield_text','shield_rank','underground','filterrank','sizerank']) {
    if (p[key]!==undefined) result[key]=p[key];
  }
  if (p.house_num!==undefined) {result.housenumber=p.house_num;result.name=String(p.house_num);}
  if (!result.rank && (p.filterrank || p.sizerank)) result.rank=p.filterrank??p.sizerank;
  return result;
}
