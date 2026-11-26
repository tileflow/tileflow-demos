// Selection follows the footprint of the flat atlas, including its overscan.
export function hasPeninsula(camera){
  const [west,south,east,north]=camera.bounds;
  return camera.z<=6&&west<=3.4&&east>=-10&&south<=44&&north>=35.8&&
    camera.lon>=-25&&camera.lon<=16&&camera.lat>=26&&camera.lat<=55;
}
