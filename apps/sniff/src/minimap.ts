import './minimap.css';

type Point = readonly number[];
type Road = {points:Point[];width:number};
type Region = {lines:Road[];water:Point[][][];areas:Point[][][]};

function trace(path:Path2D,points:readonly Point[]){
 if(!points.length)return;
 path.moveTo(points[0][0],points[0][1]);
 for(let i=1;i<points.length;i++)path.lineTo(points[i][0],points[i][1]);
}

function polygons(items:Region['water']){
 return items.map(rings=>{
  const path=new Path2D();
  for(const ring of rings){
   trace(path,ring);
   path.closePath();
  }
  return path;
 });
}

function prepare(region:Region){
 const roads=[new Path2D(),new Path2D(),new Path2D()];
 for(const road of region.lines)trace(roads[road.width>=11?2:road.width>=5?1:0],road.points);
 return {roads,water:polygons(region.water),areas:polygons(region.areas)};
}

export function createMinimap(canvas:HTMLCanvasElement){
 const desktop=matchMedia('(min-width: 900px) and (hover: hover) and (pointer: fine)');
 let region:Region|undefined,features:ReturnType<typeof prepare>|undefined;
 let ctx:CanvasRenderingContext2D|null|undefined;
 let nextFrame=0;
 let previous:{x:number;y:number;heading:number;route:readonly Point[];length:number}|undefined;

 return {
  setRegion(next:Region){
   region=next;
   features=undefined;
   previous=undefined;
  },
  draw(now:number,position:Point,heading:number,route:readonly Point[]){
   if(!desktop.matches||!region||now<nextFrame)return;
   nextFrame=now+1000/30;
   const width=canvas.clientWidth,height=canvas.clientHeight;
   if(!width||!height)return;
   const ratio=Math.min(devicePixelRatio,2);
   const pixelWidth=Math.round(width*ratio),pixelHeight=Math.round(height*ratio);
   const [x,y]=position;
   if(canvas.width!==pixelWidth||canvas.height!==pixelHeight){
    canvas.width=pixelWidth;
    canvas.height=pixelHeight;
   }else if(previous?.x===x&&previous.y===y&&Math.abs(previous.heading-heading)<.015&&
    previous.route===route&&previous.length===route.length)return;

   ctx??=canvas.getContext('2d');
   if(!ctx)return;
   features??=prepare(region);
   previous={x,y,heading,route,length:route.length};

   const cx=width/2,cy=height/2,scale=width/225;
   ctx.setTransform(ratio,0,0,ratio,0,0);
   ctx.fillStyle='#eddbb9';
   ctx.fillRect(0,0,width,height);
   ctx.save();
   ctx.translate(cx-x*scale,cy-y*scale);
   ctx.scale(scale,scale);
   ctx.fillStyle='#80b6bf';
   for(const water of features.water)ctx.fill(water,'evenodd');
   ctx.fillStyle='#faebce';
   for(const area of features.areas)ctx.fill(area,'evenodd');
   ctx.lineCap=ctx.lineJoin='round';
   ctx.strokeStyle='#b7a787';
   ctx.lineWidth=1.6;
   ctx.stroke(features.roads[0]);
   for(const [index,roadWidth] of [[1,3.2],[2,5.2]]){
    ctx.strokeStyle='#fcf0d6';
    ctx.lineWidth=roadWidth+2.1;
    ctx.stroke(features.roads[index]);
    ctx.strokeStyle=index===2?'#5c7180':'#8b9390';
    ctx.lineWidth=roadWidth;
    ctx.stroke(features.roads[index]);
   }

   if(route.length){
    const trail=new Path2D();
    trace(trail,route);
    trail.lineTo(x,y);
    ctx.lineWidth=6/scale;
    ctx.strokeStyle='#fff9ec';
    ctx.stroke(trail);
    ctx.lineWidth=3.25/scale;
    ctx.strokeStyle='#7956bf';
    ctx.stroke(trail);
   }
   ctx.restore();

   ctx.save();
   ctx.translate(cx,cy);
   ctx.beginPath();
   ctx.arc(0,0,11,0,2*Math.PI);
   ctx.fillStyle='#fff9ec';
   ctx.fill();
   ctx.lineWidth=1.5;
   ctx.strokeStyle='#263443';
   ctx.stroke();
   ctx.rotate(Math.PI-heading);
   ctx.beginPath();
   ctx.moveTo(0,-8);
   ctx.lineTo(5,5);
   ctx.lineTo(0,3);
   ctx.lineTo(-5,5);
   ctx.closePath();
   ctx.fillStyle='#177f7a';
   ctx.fill();
   ctx.restore();
  },
 };
}
