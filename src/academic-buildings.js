import * as THREE from 'three';
import { Geo, addFlatPoly, bbox, pip, distToPoly, polyArea } from './geo.js';
import { canvasTex, plainTex, rng } from './textures.js';

export const MAIN_ACADEMIC_ID = 5372151;
export const AUDITORIUM_ID = 19224287;
export const academicHeight = b => b.id === MAIN_ACADEMIC_ID ? 12.6 : b.id === AUDITORIUM_ID ? 16.8 : null;
const ANGLE=.45, C=Math.cos(ANGLE), S=Math.sin(ANGLE);
const world=(u,v)=>[u*C-v*S,u*S+v*C];
const local=([x,z])=>[x*C+z*S,-x*S+z*C];

// Reference-led details for the original academic/admin complex. The mapped
// outline and open courtyards are retained; other campus buildings use their
// existing models. Heights and hidden elevations are visual approximations.
export function createAcademicDetails({ G, mats, nightMats }) {
  const stats={buildings:0,towers:0,solarPanels:0,roofMonitors:0,windowBays:0};
  const stoneMap=canvasTex(512,512,(g,w,h)=>{
    const r=rng(718);g.fillStyle='#b9b5ac';g.fillRect(0,0,w,h);
    for(let row=0;row<8;row++)for(let col=0;col<4;col++){
      const x=col*128,y=row*64;g.fillStyle=`rgba(${r()>.5?'255,255,245':'70,66,58'},${.025+r()*.045})`;g.fillRect(x,y,128,64);
      g.strokeStyle='rgba(85,82,76,.23)';g.lineWidth=1;g.strokeRect(x,y,128,64);
    }
    for(let i=0;i<18000;i++){g.fillStyle=`rgba(70,67,60,${r()*.07})`;g.fillRect(r()*w,r()*h,1,1);}
  });
  mats.set('acad_stone',new THREE.MeshStandardMaterial({map:stoneMap,bumpMap:stoneMap,bumpScale:.016,roughness:.9}));
  mats.set('acad_red',new THREE.MeshStandardMaterial({map:plainTex('#9b473f',730,.075),roughness:.95}));
  mats.set('acad_trim',new THREE.MeshStandardMaterial({map:plainTex('#c4c1b6',731,.035),roughness:.85}));
  mats.set('acad_recess',new THREE.MeshStandardMaterial({color:'#333f3b',roughness:.9}));
  const glass=new THREE.MeshStandardMaterial({color:'#3c6661',roughness:.2,metalness:.3,envMapIntensity:.65,emissive:'#b69a64',emissiveIntensity:0});
  mats.set('acad_glass',glass);nightMats.push(glass);
  mats.set('acad_metal',new THREE.MeshStandardMaterial({color:'#929b99',roughness:.65,metalness:.45}));
  mats.set('acad_roof',new THREE.MeshStandardMaterial({map:plainTex('#b8b6ad',732,.08),roughness:.98}));
  mats.set('acad_auditorium_roof',new THREE.MeshStandardMaterial({map:plainTex('#91948b',739,.065),roughness:.94}));
  const panels=[],monitors=[];
  const box=(key,u,v,w,d,y0,y1)=>{const [x,z]=world(u,v);G(key).box(x,z,w,d,y0,y1,ANGLE,.25);};

  function elevation(pts,H,hole=false,auditorium=false) {
    // Ring winding varies between mapped outer contours and courtyard holes.
    const winding=polyArea(pts)>0?1:-1;
    for(let i=0;i<pts.length;i++) {
      const a=pts[i],b=pts[(i+1)%pts.length],dx=b[0]-a[0],dz=b[1]-a[1],len=Math.hypot(dx,dz);
      if(len<.05)continue;
      const tx=dx/len,tz=dz/len,nx=tz*winding*(hole?-1:1),nz=-tx*winding*(hole?-1:1),ang=Math.atan2(tz,tx);
      const quad=(key,y0,y1,offset=0)=>{
        const p=[a[0]+nx*offset,a[1]+nz*offset],q=[b[0]+nx*offset,b[1]+nz*offset];
        const normal=[nx,0,nz],geo=G(key),uv=[[0,y0/4],[0,y1/4],[len/4,y1/4],[len/4,y0/4]];
        if(winding*(hole?-1:1)>0)geo.quad([p[0],y0,p[1]],[p[0],y1,p[1]],[q[0],y1,q[1]],[q[0],y0,q[1]],normal,...uv);
        else geo.quad([q[0],y0,q[1]],[q[0],y1,q[1]],[p[0],y1,p[1]],[p[0],y0,p[1]],normal,uv[3],uv[2],uv[1],uv[0]);
      };
      const feature=(key,t,w,depth,y0,y1,offset=.12)=>G(key).box(a[0]+tx*t+nx*offset,a[1]+tz*t+nz*offset,w,depth,y0,y1,ang,.25);
      const redTop=auditorium?H-1.5:8.6;
      quad('acad_stone',0,.65);quad(len>10?'acad_red':'acad_stone',.65,redTop);quad('acad_stone',redTop,H+.65);
      // Real overhangs and piers cast shadows instead of painted window bands.
      feature('acad_trim',len/2,len,.65,H-.1,H+.12,.12);
      feature('acad_trim',len/2,len,.48,H+.55,H+.72,.06);
      if(len<10)continue;
      feature('acad_trim',len/2,len,.34,redTop-.12,redTop+.12,.1);
      const bays=Math.max(1,Math.round(len/4.5)),bay=len/bays;
      for(let j=0;j<bays;j++) {
        const t=(j+.5)*bay,ww=Math.min(2.1,bay*.55);stats.windowBays++;
        feature('acad_trim',j*bay+.25,.5,.5,.65,redTop,.16);
        feature('acad_recess',t,ww+.32,.09,1,redTop-.35,.02);
        // Two-storey openings separated by the actual floor slab and mullions.
        for(let y=1.25;y<redTop-1.3;y+=3.65) {
          feature('acad_glass',t,ww,.08,y,Math.min(y+2.65,redTop-.45),.075);
          feature('acad_trim',t-ww/2-.09,.16,.26,y-.14,Math.min(y+2.8,redTop-.3),.14);
          feature('acad_trim',t+ww/2+.09,.16,.26,y-.14,Math.min(y+2.8,redTop-.3),.14);
          feature('acad_trim',t,ww+.32,.3,y-.15,y,.14);
          feature('acad_metal',t,.055,.1,y,Math.min(y+2.65,redTop-.45),.13);
        }
        if(!auditorium) {
          feature('acad_recess',t,bay*.62,.1,9.45,11.25,.025);
          feature('acad_glass',t,bay*.56,.08,9.6,11.1,.09);
          feature('acad_trim',t,bay*.67,.4,11.25,11.4,.18);
          feature('acad_trim',t,bay*.65,.36,9.3,9.45,.14);
          feature('acad_metal',t,.07,.1,9.6,11.1,.15);
        }
      }
    }
  }

  const towers=[[-103.5,-227],[-103.5,-178],[-104,12.5],[-104,61],[-138.5,-164],[-138.5,-122.5],[-139,-42],[-140,-1],[-180,-178],[-180,-122],[-180,-30],[-180,17]];
  function tower(u,v,H) {
    const top=H+3.2;stats.towers++;
    box('acad_stone',u,v,7.4,7.4,0,top);
    // Green stairwell glazing on the front and outer return of each tower.
    box('acad_recess',u+3.73,v,.08,2.65,2.2,top-1.2);
    box('acad_glass',u+3.8,v,.08,2.3,2.4,top-1.4);
    box('acad_trim',u+3.9,v-1.33,.35,.2,2.2,top-1.2);
    box('acad_trim',u+3.9,v+1.33,.35,.2,2.2,top-1.2);
    for(let y=3;y<top-1.2;y+=3.1)box('acad_metal',u+3.9,v,.1,2.4,y,y+.1);
    box('acad_metal',u+3.9,v,.1,.07,2.4,top-1.4);
    for(let tier=0;tier<3;tier++) {
      const w=8.4-tier*1.25,y=top+tier*.62;
      box('acad_red',u,v,w,w,y,y+.45);
      box('acad_trim',u,v,w+.35,w+.35,y+.45,y+.61);
    }
    for(let y=3.9;y<top;y+=3.9) {
      box('acad_trim',u,v,7.48,7.48,y,y+.075);
    }
  }

  function roofs(b,H) {
    const points=b.outer.map(local),bounds=bbox(points);
    const roofInside=(u,v)=>{
      const [x,z]=world(u,v);
      return pip(x,z,b.outer)&&distToPoly(x,z,b.outer)>1.5&&!b.holes.some(h=>pip(x,z,h)||distToPoly(x,z,h)<1.5)
        &&!towers.some(([tu,tv])=>Math.abs(tu-u)<5.2&&Math.abs(tv-v)<5.2)
        &&!(u>-177&&u<-143&&v>-98&&v<-64);
    };
    for(let u=Math.ceil(bounds[0]/4.5)*4.5;u<bounds[2];u+=4.5)for(let v=Math.ceil(bounds[1]/2.3)*2.3;v<bounds[3];v+=2.3) {
      if(![[-1.95,-.95],[1.95,-.95],[1.95,.95],[-1.95,.95]].every(([du,dv])=>roofInside(u+du,v+dv)))continue;
      if(v<-97) {
        panels.push({u,v,y:H+.65});stats.solarPanels++;
        box('acad_metal',u-1.1,v,.12,1.8,H+.05,H+.6);
        box('acad_metal',u+1.1,v,.12,1.8,H+.05,H+.6);
      } else if(Math.round(u/4.5)%2===0&&Math.round(v/2.3)%2===0
        &&[[-3.6,-.9],[3.6,-.9],[3.6,.9],[-3.6,.9]].every(([du,dv])=>roofInside(u+du,v+dv))) {
        monitors.push({u,v,y:H});stats.roofMonitors++;
        box('acad_trim',u-2.5,v,.2,1.4,H+.04,H+.75);
        box('acad_trim',u+2.5,v,.2,1.4,H+.04,H+.75);
      }
    }
    // Low service housings, aligned with the roof grid rather than scattered.
    for(let v=bounds[1]+12;v<bounds[3];v+=32) {
      const u=bounds[0]+12;if(!roofInside(u,v))continue;
      box('acad_trim',u,v,3,2.2,H,H+1.45);
      for(let k=0;k<4;k++)box('acad_metal',u+1.53,v-.7+k*.45,.1,.25,H+.4,H+1.15);
    }
  }

  function build(b,H) {
    stats.buildings++;
    const auditorium=b.id===AUDITORIUM_ID;
    elevation(b.outer,H,false,auditorium);
    for(const hole of b.holes)elevation(hole,H,true,auditorium);
    addFlatPoly(G(auditorium?'acad_auditorium_roof':'acad_roof'),b.outer,b.holes,H,.25);
    if(auditorium)return;
    towers.forEach(([u,v])=>tower(u,v,H));
    // The central stone entrance stands in front of the admin wing, with an
    // open two-storey portal, shaded glass behind it and broad shallow steps.
    for(const v of [-88,-74])box('acad_stone',-148,v,3,3.8,0,10);
    box('acad_stone',-148,-81,3,17.8,10,14.1);
    box('acad_trim',-148,-81,3.6,18.4,14.1,14.4);
    box('acad_glass',-153,-81,.12,10,0,9.6);
    box('acad_glass',-146.4,-81,.08,8.5,10.7,13.2);
    for(let i=0;i<3;i++)box('acad_stone',-144.5+i*.8,-81,1.7,13+i*.8,0,.48-i*.14);
    roofs(b,H);
  }

  function finish(group) {
    const dummy=new THREE.Object3D();
    const solarMap=canvasTex(512,256,(g,w,h)=>{
      g.fillStyle='#376b9c';g.fillRect(0,0,w,h);
      for(let y=0;y<4;y++)for(let x=0;x<12;x++) {
        g.fillStyle=(x+y)%3?'#315f8f':'#3f729e';g.fillRect(x*w/12+1,y*h/4+1,w/12-2,h/4-2);
      }
      g.strokeStyle='#b4bfbe';g.lineWidth=3;g.strokeRect(1,1,w-2,h-2);
    });
    const instances=(items,geometry,material,transform)=>{
      const m=new THREE.InstancedMesh(geometry,material,items.length);
      items.forEach((p,i)=>{const [x,z]=world(p.u,p.v);dummy.position.set(x,p.y,z);dummy.rotation.set(0,-ANGLE,0);transform(p,dummy);dummy.updateMatrix();m.setMatrixAt(i,dummy.matrix);});
      m.castShadow=true;m.receiveShadow=true;m.computeBoundingSphere();group.add(m);
    };
    instances(panels,new THREE.BoxGeometry(3.8,.07,1.8),new THREE.MeshStandardMaterial({map:solarMap,roughness:.32,metalness:.4}),(_,d)=>d.rotateZ(.18));
    // Sloping roof monitors: light stone sides with a narrow green glass face.
    const monitor=new Geo();monitor.box(0,0,6.8,1.4,0,.14);
    instances(monitors,monitor.build(),mats.get('acad_trim'),(_,d)=>{d.position.y+=.85;d.rotateX(.55);});
    window.__academicBuildings=()=>({...stats,mainRoofHeight:12.6});
  }
  return {build,finish};
}
