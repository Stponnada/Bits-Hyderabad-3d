import { Geo, addRibbon, bbox, pip, distToPoly } from './geo.js';

// Use the same ribbon and apron widths as buildRoads, including mitered bends.
// This lets formal planting stop at intersecting streets and their sidewalks.
export function createPavingMask(data) {
  const mask=[];
  for(const road of data.roads) {
    const bounds=bbox(road.pts);
    if(bounds[2]<-100||bounds[0]>170||bounds[3]<-390||bounds[1]>-80)continue;
    const foot=['foot','path','track'].includes(road.kind);
    const pts=road.closed?road.pts.slice(0,-1):road.pts;
    if(pts.length<2)continue;
    const mid=pts[pts.length>>1];
    const width=foot?road.w:(road.kind==='service'?5.6:road.w)+(pip(...mid,data.boundary)?4.4:0);
    const ribbon=new Geo();addRibbon(ribbon,pts,width,()=>0,{closed:road.closed});
    for(let i=0;i<ribbon.i.length;i+=3) {
      const polygon=ribbon.i.slice(i,i+3).map(j=>[ribbon.p[j*3],ribbon.p[j*3+2]]);
      mask.push({polygon,bounds:bbox(polygon)});
    }
  }
  return mask;
}
const overlaps=(a,b)=>a[0]<=b[2]&&a[2]>=b[0]&&a[1]<=b[3]&&a[3]>=b[1];
export function clearOfPaving(mask,x,z,radius=0) {
  return !mask.some(({polygon,bounds})=>overlaps([x-radius,z-radius,x+radius,z+radius],bounds)
    &&(pip(x,z,polygon)||distToPoly(x,z,polygon)<radius));
}
// Split a polygon against an edge, interpolating UVs at the new vertices.
function split(polygon,side) {
  const inside=[],outside=[];
  for(let i=0;i<polygon.length;i++) {
    const a=polygon[i],b=polygon[(i+1)%polygon.length],da=side(a),db=side(b);
    (da>=0?inside:outside).push(a);
    if((da>=0)!==(db>=0)) {
      const t=da/(da-db),p=a.map((v,k)=>v+(b[k]-v)*t);
      inside.push(p);outside.push(p);
    }
  }
  return {inside,outside};
}
function subtract(polygon,cut) {
  // Upward-facing triangles have clockwise winding in the x/z plane.
  const sides=cut.map((a,i)=>{const b=cut[(i+1)%cut.length];return p=>(b[1]-a[1])*(p[0]-a[0])-(b[0]-a[0])*(p[2]-a[1]);});
  if(sides.some(side=>polygon.every(p=>side(p)<=0)))return [polygon];
  const result=[];let remaining=polygon;
  for(const side of sides) {
    const pieces=split(remaining,side);
    if(pieces.outside.length>=3)result.push(pieces.outside);
    remaining=pieces.inside;
    if(remaining.length<3)break;
  }
  return result;
}
export function clipPaving(geo,mask) {
  const result=new Geo();
  for(let i=0;i<geo.i.length;i+=3) {
    const triangle=geo.i.slice(i,i+3).map(j=>[...geo.p.slice(j*3,j*3+3),...geo.uv.slice(j*2,j*2+2)]);
    const bounds=bbox(triangle.map(p=>[p[0],p[2]]));
    let pieces=[triangle];
    for(const cut of mask) {
      if(!overlaps(bounds,cut.bounds))continue;
      pieces=pieces.flatMap(p=>subtract(p,cut.polygon));
      if(!pieces.length)break;
    }
    for(const piece of pieces)for(let j=1;j<piece.length-1;j++) {
      const a=piece[0],b=piece[j],c=piece[j+1];
      if(Math.abs((b[2]-a[2])*(c[0]-a[0])-(b[0]-a[0])*(c[2]-a[2]))<1e-8)continue;
      result.tri(a.slice(0,3),b.slice(0,3),c.slice(0,3),[0,1,0],a.slice(3),b.slice(3),c.slice(3));
    }
  }
  return result;
}
