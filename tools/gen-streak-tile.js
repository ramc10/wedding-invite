// Pre-render road.js's old SMEAR SVG (feTurbulence) to art/streak.webp for a normal-blend .streaks.
// usage (needs `npm i playwright`): node tools/gen-streak-tile.js site/art/streak.webp [scale=2]
//  - vertical seam: T'(y) = w*T(y) + (1-w)*T((y+H/2)%H), w = sin^2(pi*y/H) -> periodic, no seam
//    (feTurbulence stitchTiles does not tile seamlessly in Chromium; the old tile mask meant to hide it
//     never applied — see report)
//  - horizontal edge fade 0-18%-82%-100% baked into alpha (tile width == element width)
//  - overlay -> normal: overlay of light grey g (g>.5 everywhere here) at alpha a over tarmac b adds
//    a*b*(2g-1); a normal-blend colour 2*B0 at alpha a*(2g-1) adds a*(2g-1)*(2*B0-b): identical at b=B0,
//    B0 = mean tarmac RGB under the smear measured from baseline in-motion screenshots. GAIN makes up
//    the energy the (now actually applied) verge fade and the crossfade take out, so total lift matches.
const fs=require('fs');
const {chromium}=require('playwright');
const SMEAR="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='200' height='420'%3E%3Cfilter id='s'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.03 0.006' numOctaves='3' stitchTiles='stitch'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='200' height='420' filter='url(%23s)' opacity='.7'/%3E%3C/svg%3E";
const out=process.argv[2],K=+(process.argv[3]||2),B0=[.438,.381,.304],GAIN=1.3;
(async()=>{const b=await chromium.launch();const p=await b.newPage();
const u=await p.evaluate(async({SMEAR,K,B0,GAIN})=>{const img=new Image();img.src=SMEAR;await img.decode();
 const W=200*K,H=420*K;const c=document.createElement('canvas');c.width=W;c.height=H;const x=c.getContext('2d');x.drawImage(img,0,0,W,H);
 const d=x.getImageData(0,0,W,H).data,o=new Uint8ClampedArray(d.length);
 const ramp=(t,e)=>t<e?t/e:t>1-e?(1-t)/e:1;
 for(let j=0;j<H;j++){const w=Math.sin(Math.PI*(j+.5)/H)**2,j2=(j+H/2)%H;
  for(let i=0;i<W;i++){const k=(j*W+i)*4,k2=(j2*W+i)*4;
   const g=(w*d[k]+(1-w)*d[k2])/255,a=(w*d[k+3]+(1-w)*d[k2+3])/255*ramp((i+.5)/W,.18);
   for(let ch=0;ch<3;ch++)o[k+ch]=Math.round(255*2*B0[ch]);o[k+3]=Math.round(255*Math.min(1,GAIN*a*Math.max(0,2*g-1)));}}
 x.putImageData(new ImageData(o,W,H),0,0);return c.toDataURL('image/webp',.85);},{SMEAR,K,B0,GAIN});
fs.writeFileSync(out,Buffer.from(u.split(',')[1],'base64'));await b.close();})();
