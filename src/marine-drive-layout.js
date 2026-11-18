import { createPavingMask } from './landscape-paving.js';
import { pip, distToPoly } from './geo.js';

// Surveyed carriageways stay in place. These planted spaces follow their actual
// coordinates; the aerial reference supplies the lawn / verge / woodland order.
export const MARINE_LAWNS = [
  [[16,-256],[39,-272],[47,-265],[55,-246],[59,-228],[62,-207],[53,-201],[34,-199],[16,-202],[-8,-197]],
  [[-47,-149],[-30,-168],[-6,-176],[17,-175],[35,-166],[46,-151],[50,-138],[43,-124],[40,-113],[44,-103],[28,-97],[7,-103],[-18,-113],[-44,-123],[-56,-129]],
];
let layout = null;
function pointOnLine(pts, distance) {
  for (let i=1; i<pts.length; i++) {
    const a=pts[i-1], b=pts[i], length=Math.hypot(b[0]-a[0], b[1]-a[1]);
    if (distance<=length || i===pts.length-1) {
      const t=Math.max(0,Math.min(1,distance/length));
      return { x:a[0]+(b[0]-a[0])*t, z:a[1]+(b[1]-a[1])*t, nx:(b[1]-a[1])/length, nz:-(b[0]-a[0])/length };
    }
    distance-=length;
  }
}
// Blend the tangent through surveyed corners so wide offset beds stay smooth.
export function sampleLine(pts,distance) {
  const point=pointOnLine(pts,distance);
  const a=pointOnLine(pts,Math.max(0,distance-4)),b=pointOnLine(pts,distance+4);
  const length=Math.hypot(b.x-a.x,b.z-a.z);
  if(length>1e-6){point.nx=(b.z-a.z)/length;point.nz=-(b.x-a.x)/length;}
  return point;
}
const lengthOf = pts => pts.slice(1).reduce((s,p,i)=>s+Math.hypot(p[0]-pts[i][0],p[1]-pts[i][1]),0);
export const offsetPoint = (p,d) => [p.x+p.nx*d,p.z+p.nz*d];
export function prepareMarineDrive(data) {
  const drive=data.roads.find(r=>Math.hypot(r.pts[0][0]+36.92,r.pts[0][1]+359.18)<1).pts;
  // Continue around the outside of the southern roundabout to its east exit.
  const ring=data.roads.find(r=>r.closed&&Math.hypot(r.pts[0][0]-59.72,r.pts[0][1]+124.66)<1).pts;
  const join=ring.findIndex(p=>Math.hypot(p[0]-drive.at(-1)[0],p[1]-drive.at(-1)[1])<.1);
  const exit=ring.findIndex(p=>Math.hypot(p[0]-82.62,p[1]+112.55)<.1);
  const outer=[...drive,...ring.slice(join+1,exit+1)];
  const inner=[...data.roads.find(r=>Math.hypot(r.pts[0][0]-75.5,r.pts[0][1]+129.53)<1).pts].reverse();
  const length=lengthOf(outer), driveLength=lengthOf(drive), innerLength=lengthOf(inner), start=23, end=length;
  const treeEnd=driveLength-27;
  const samples=[];
  for(let s=start;s<=end;s+=2) samples.push(sampleLine(outer,s));
  samples.push(sampleLine(outer,end));
  const garden=[...samples.map(p=>offsetPoint(p,5.1)),...samples.toReversed().map(p=>offsetPoint(p,26))];
  const roadSamples=samples.filter((_,i)=>start+i*2<=treeEnd);
  roadSamples.push(sampleLine(outer,treeEnd));
  const corridor=[...roadSamples.map(p=>offsetPoint(p,-18)),...roadSamples.toReversed().map(p=>offsetPoint(p,28))];
  const palms=[];
  for(let s=35;s<driveLength-33;s+=14){const a=sampleLine(outer,s),b=sampleLine(inner,s/driveLength*innerLength);palms.push([(a.x+b.x)/2,(a.z+b.z)/2]);}
  layout={outer,inner,length,start,end,treeEnd,samples,garden,corridor,palms,paving:createPavingMask(data)};
  return layout;
}
export const marineLayout=()=>layout;
export function marineReserved(x,z,margin=0) {
  if(!layout || x < -90 || x > 150 || z < -375 || z > -85) return false;
  return MARINE_LAWNS.some(p=>pip(x,z,p)||distToPoly(x,z,p)<4+margin)
    || pip(x,z,layout.corridor) || distToPoly(x,z,layout.corridor)<margin
    || pip(x,z,layout.garden) || distToPoly(x,z,layout.garden)<margin+2;
}
function segmentDistance(x,z,a,b) {
  const dx=b[0]-a[0], dz=b[1]-a[1], t=Math.max(0,Math.min(1,((x-a[0])*dx+(z-a[1])*dz)/(dx*dx+dz*dz||1)));
  return Math.hypot(x-a[0]-t*dx,z-a[1]-t*dz);
}
export function arrangeMarineTrees(trees,data) {
  if(!layout) return;
  const displaced=[], occupied=[];
  for(const t of trees) {
    const palm=t.kind==='palm'&&t.x>-150&&t.x<105&&t.z>-340&&t.z<-125;
    if(marineReserved(t.x,t.z)||palm) displaced.push(t);
    else if(t.x>-120&&t.x<260&&t.z>-390&&t.z<-80) occupied.push(t);
  }
  const valid=(x,z)=>!marineReserved(x,z,1)&&pip(x,z,data.boundary)
    &&!data.buildings.some(b=>pip(x,z,b.outer)||distToPoly(x,z,b.outer)<5)
    &&!data.areas.some(a=>!['grass','park'].includes(a.kind)&&(pip(x,z,a.pts)||distToPoly(x,z,a.pts)<2))
    &&!data.roads.some(r=>r.pts.some((p,i)=>i&&segmentDistance(x,z,r.pts[i-1],p)<(r.kind==='service'?5.6:r.w)/2+4))
    &&!occupied.some(t=>Math.hypot(x-t.x,z-t.z)<3.4);
  let i=0;
  for(const [x,z] of layout.palms) {
    const t=displaced[i++];if(!t) break;
    Object.assign(t,{x,z,kind:'palm',s:.72+(i%4)*.035});occupied.push(t);
  }
  // Small, regularly spaced crowns mark the academic lawn edge, leaving the
  // centre open. Reuse existing trees rather than increasing the population.
  for(const polygon of MARINE_LAWNS) for(let e=0;e<polygon.length;e++) {
    const a=polygon[e],b=polygon[(e+1)%polygon.length],len=Math.hypot(b[0]-a[0],b[1]-a[1]);
    if(len<13) continue;
    const mid=[(a[0]+b[0])/2,(a[1]+b[1])/2],c=polygon.reduce((q,p)=>[q[0]+p[0]/polygon.length,q[1]+p[1]/polygon.length],[0,0]);
    const d=Math.hypot(mid[0]-c[0],mid[1]-c[1]);
    const x=mid[0]+(mid[0]-c[0])/d*7,z=mid[1]+(mid[1]-c[1])/d*7;
    if(!valid(x,z))continue;
    const t=displaced[i++];if(!t)break;
    Object.assign(t,{x,z,kind:'broad',s:.7});occupied.push(t);
  }
  let cursor=0;
  // The remaining displaced trees reinforce woodland behind the formal verge.
  // All unrelated planting on the rest of campus is left at its old position.
  for(;i<displaced.length;i++) {
    const t=displaced[i];let placed=false;
    for(let attempt=0;attempt<2500;attempt++) {
      const n=cursor++,s=layout.start+(n*.754877666%1)*(layout.treeEnd-layout.start),p=sampleLine(layout.outer,s);
      const [x,z]=offsetPoint(p,33+(n*.569840296%1)*91);
      if(!valid(x,z))continue;
      Object.assign(t,{x,z});occupied.push(t);placed=true;break;
    }
    // Out of clear woodland positions: leave the remaining trees where they were surveyed
    // rather than failing the whole scene when the tree data changes.
    if(!placed){console.warn(`Marine Drive: ${displaced.length-i} displaced trees kept in place`);break;}
  }
  layout.relocated=displaced.length;
  layout.violations=trees.filter(t=>t.kind!=='palm'&&marineReserved(t.x,t.z)).length;
}
