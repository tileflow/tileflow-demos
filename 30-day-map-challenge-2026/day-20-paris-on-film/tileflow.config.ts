import {defineMap, defineTheme, disable, labels} from '@tileflow/core';
import {streets, streetsThemes} from '@tileflow/maps';

const porcelain = defineTheme(streetsThemes.light, {
  id: 'porcelain', version: 1, colorScheme: 'light',
  tokens: {color: {
    'surface.background':'#f4f1ec','surface.background.transition':'#f4f1ec','surface.background.overview':'#f4f1ec',
    'landuse.residential':'#f0ede8','landuse.industrial':'#eae8e3','landcover.urbanPark':'#e3e1db',
    'landcover.wood':'#e0dfd9','hydro.water':'#c3c4c4','hydro.water.regional':'#c3c4c4',
    'buildings.fill':'#fcf9f2','buildings.outline':'#dfddd8','roads.city.primary':'#d4d3cf',
    'roads.city.secondary':'#dddad5','roads.city.tertiary':'#e2dfda','roads.city.minor':'#e8e6e2',
    'labels.primary':'#504b48','labels.road':'#5e5959','labels.halo':'#faf8f4'
  }}
});
export default defineMap({
  id:'film', name:'Paris on Film', version:1, extends:streets, projection:'mercator', terrain:'none', models:[],
  themes:{porcelain}, defaultTheme:'porcelain', view:{center:[2.3425,48.8568],zoom:14},
  modules:{buildings:disable(),vegetation:disable(),poi:disable(),labels:labels({roads:'streets',places:'all',water:'none'})}
});
