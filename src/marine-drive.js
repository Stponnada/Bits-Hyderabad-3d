import { clearOfPaving, clipPaving } from './landscape-paving.js';
import * as THREE from 'three';
import { Geo, addFlatPoly, addRibbon, bbox, pip, distToPoly } from './geo.js';
import { grassTex, plainTex, rng } from './textures.js';
import { surfaceMaterial } from './surfaces.js';
import { blob, merge, plantMaterials } from './plants.js';
import { MARINE_LAWNS, marineLayout, sampleLine, offsetPoint } from './marine-drive-layout.js';

export function buildMarineDrive(scene) {
  const L=marineLayout(), group=new THREE.Group(); group.name='Marine Drive formal landscaping';
  const mesh=(g,m,clip=true)=>{const o=new THREE.Mesh((clip?clipPaving(g,L.paving):g).build(),m);o.receiveShadow=true;group.add(o);return o;};
  const turf=new THREE.MeshStandardMaterial({map:grassTex(),color:'#c1ce91',roughness:1});
  const clay=surfaceMaterial('pavers','#b77552');
  const soil=new THREE.MeshStandardMaterial({map:plainTex('#72513a',303,.16),roughness:1});
  const lawn=new Geo();
  for(const polygon of MARINE_LAWNS)addFlatPoly(lawn,polygon,[],.065,1/7);
  addFlatPoly(lawn,L.garden,[],.065,1/7);mesh(lawn,turf);
  const edging=new Geo();
  for(const polygon of MARINE_LAWNS)addRibbon(edging,polygon,.45,()=>.09,{closed:true,vScale:1/1.6});
  // The inner edge meanders; the back follows the road, with transverse red
  // paths dividing the long bed into planted compartments.
  const wave=s=>12.6+1.5*Math.sin((s-L.start)*.055)+.7*Math.sin(s*.12);
  const bedPoint=(s,d)=>offsetPoint(sampleLine(L.outer,s),d);
  const beds=new Geo(), paths=new Geo(), shrubs=[], flowers=[], random=rng(6281);
  for(let start=L.start+3;start<L.end-2;start+=24) {
    const end=Math.min(start+21,L.end-2), front=[],back=[];
    for(let s=start;s<=end;s+=1.5){front.push(bedPoint(s,wave(s)+.8));back.push(bedPoint(s,24));}
    front.push(bedPoint(end,wave(end)+.8));back.push(bedPoint(end,24));
    const polygon=[...front,...back.toReversed()];addFlatPoly(beds,polygon,[],.09,.4);
    addRibbon(paths,[...front,...back.toReversed()],.65,()=>.12,{closed:true,vScale:.5});
    // Space plants in world metres, including the wider fan around the bend.
    const bounds=bbox(polygon);
    for(let gx=bounds[0];gx<bounds[2];gx+=.9)for(let gz=bounds[1];gz<bounds[3];gz+=.9){
      const x=gx+(random()-.5)*.3,z=gz+(random()-.5)*.3;
      if(!pip(x,z,polygon)||distToPoly(x,z,polygon)<.65)continue;
      shrubs.push({x,z,s:.43+random()*.14,c:random()>.5?'#7a9542':'#416333'});
      if(random()<.46)flowers.push({plant:shrubs[shrubs.length-1],x:x+.12,z,s:.07+random()*.08,c:random()>.3?'#d6bb69':'#d29e91'});
    }
    // Periodic low flowering topiary pots sit on the uncluttered lawn verge.
    const s=(start+end)/2,[x,z]=bedPoint(s,7.8);
    shrubs.push({x,z,s:.75,c:'#536a37',pot:true});
    for(let n=0;n<30;n++){const a=random()*Math.PI*2,r=Math.sqrt(random())*.68;flowers.push({plant:shrubs[shrubs.length-1],x:x+Math.cos(a)*r,z:z+Math.sin(a)*r,s:.1+random()*.08,c:n%3?'#b94182':'#d673a4',y:1.15+random()*.35});}
  }
  const innerPath=[] ,outerPath=[];
  for(let s=L.start;s<=L.end;s+=1.3){innerPath.push(bedPoint(s,wave(s)));outerPath.push(bedPoint(s,25.4));}
  addRibbon(paths,innerPath,1.25,()=>.13,{vScale:.5});
  addRibbon(paths,outerPath,1.15,()=>.13,{vScale:.5});
  mesh(beds,soil);mesh(paths,clay);mesh(edging,clay);
  // A slim grass median supports one orderly palm row between carriageways.
  const median=new Geo();addRibbon(median,L.palms,1.6,()=>.13,{vScale:.2});mesh(median,turf,false);
  const unit=merge([{geo:blob(1,1,.65,304,'#ffffff','#b4b4b4',.25),up:.8,uvWorld:true}]);
  const object=new THREE.Object3D(),color=new THREE.Color();
  const instances=(items,geo,mat,position)=>{const m=new THREE.InstancedMesh(geo,mat,items.length);items.forEach((p,i)=>{position(p);object.rotation.y=i*2.4;object.updateMatrix();m.setMatrixAt(i,object.matrix);m.setColorAt(i,color.set(p.c));});m.castShadow=true;m.receiveShadow=true;m.computeBoundingSphere();group.add(m);};
  const clearShrubs=shrubs.filter(p=>clearOfPaving(L.paving,p.x,p.z,p.pot?1:Math.max(.85,p.s*1.4)));
  const retainedPlants=new Set(clearShrubs);
  const clearFlowers=flowers.filter(p=>retainedPlants.has(p.plant)&&clearOfPaving(L.paving,p.x,p.z,p.s+.15));
  instances(clearShrubs,unit,plantMaterials().solid,p=>{object.position.set(p.x,p.pot?1.05:.35,p.z);object.scale.set(p.s,p.s*.75,p.s);});
  instances(clearFlowers,new THREE.IcosahedronGeometry(1,0),new THREE.MeshStandardMaterial({vertexColors:false,roughness:.9}),p=>{object.position.set(p.x,p.y??.63,p.z);object.scale.set(p.s,p.s*.6,p.s);});
  instances(clearShrubs.filter(p=>p.pot).map(p=>({...p,c:'#ac7154'})),new THREE.CylinderGeometry(.62,.4,.65,10),new THREE.MeshStandardMaterial({roughness:1}),p=>{object.position.set(p.x,.4,p.z);object.scale.setScalar(1);});
  const stone=new THREE.Mesh(new THREE.DodecahedronGeometry(1,1),new THREE.MeshStandardMaterial({color:'#a6a398',roughness:1}));
  const [x,z]=bedPoint(L.start+(L.treeEnd-L.start)*.6,8.8);stone.position.set(x,.7,z);stone.scale.set(2.2,1.1,1.5);stone.rotation.y=.5;stone.castShadow=stone.receiveShadow=true;group.add(stone);
  if(!clearOfPaving(L.paving,x,z,2.5))group.remove(stone);
  scene.add(group);
  window.__marineDrive=()=>({relocatedTrees:L.relocated,palms:L.palms.length,lawnTreeViolations:L.violations+(L.companionViolations||0),plantingBeds:Math.ceil((L.end-L.start-5)/24),shrubs:clearShrubs.length});
}
