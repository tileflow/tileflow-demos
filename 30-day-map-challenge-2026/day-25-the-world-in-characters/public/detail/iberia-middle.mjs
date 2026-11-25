// Small regional gazetteer, loaded only when the peninsular sheet needs it.
// Cities are ordered by editorial rank (0–4). River rank 1 is a main stem.
// Each area anchor includes measured clearance to its region's boundary in km.
let pending;

export function loadIberiaPlaces(){
  if(!pending){
    pending=fetch(new URL('./iberia-middle.json?v=regional-reading-1',import.meta.url))
      .then(response=>{
        if(!response.ok)throw Error('Iberian regional geography unavailable');
        return response.json();
      })
      .catch(error=>{
        pending=undefined;
        throw error;
      });
  }
  return pending;
}
