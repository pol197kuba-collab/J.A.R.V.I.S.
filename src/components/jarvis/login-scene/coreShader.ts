// GLSL of the molten Arc Core (the look of drei's MeshDistortMaterial, as a
// small simplex-noise shader). Single source for BOTH renderers: the imperative
// intro scene (world units, sphere radius 72) and the R3F /jarvis canvas (app
// units, radius 0.72). The vertex displacement is proportional to the sphere
// radius, so the same text works at either scale. Port of reactor.js buildCore().
// Three-free: only strings.

export const NOISE = /* glsl */ `
vec3 m289(vec3 x){return x-floor(x*(1./289.))*289.;}vec4 m289(vec4 x){return x-floor(x*(1./289.))*289.;}
vec4 perm(vec4 x){return m289(((x*34.)+1.)*x);}vec4 tis(vec4 r){return 1.79284291400159-.85373472095314*r;}
float snoise(vec3 v){const vec2 C=vec2(1./6.,1./3.);const vec4 D=vec4(0.,.5,1.,2.);vec3 i=floor(v+dot(v,C.yyy));vec3 x0=v-i+dot(i,C.xxx);
vec3 g=step(x0.yzx,x0.xyz);vec3 l=1.-g;vec3 i1=min(g.xyz,l.zxy);vec3 i2=max(g.xyz,l.zxy);vec3 x1=x0-i1+C.xxx;vec3 x2=x0-i2+C.yyy;vec3 x3=x0-D.yyy;
i=m289(i);vec4 p=perm(perm(perm(i.z+vec4(0.,i1.z,i2.z,1.))+i.y+vec4(0.,i1.y,i2.y,1.))+i.x+vec4(0.,i1.x,i2.x,1.));
float n_=.142857142857;vec3 ns=n_*D.wyz-D.xzx;vec4 j=p-49.*floor(p*ns.z*ns.z);vec4 x_=floor(j*ns.z);vec4 y_=floor(j-7.*x_);vec4 x=x_*ns.x+ns.yyyy;vec4 y=y_*ns.x+ns.yyyy;vec4 h=1.-abs(x)-abs(y);
vec4 b0=vec4(x.xy,y.xy);vec4 b1=vec4(x.zw,y.zw);vec4 s0=floor(b0)*2.+1.;vec4 s1=floor(b1)*2.+1.;vec4 sh=-step(h,vec4(0.));vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy;vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;
vec3 p0=vec3(a0.xy,h.x);vec3 p1=vec3(a0.zw,h.y);vec3 p2=vec3(a1.xy,h.z);vec3 p3=vec3(a1.zw,h.w);vec4 norm=tis(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));p0*=norm.x;p1*=norm.y;p2*=norm.z;p3*=norm.w;
vec4 m=max(.6-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.);m=m*m;return 42.*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));}`;

const num = (n: number) => n.toFixed(4);

/** Vertex shader for a sphere of radius `radius` (72 in the demo's world units, 0.72 in app units). */
export const coreVertex = (radius: number) =>
  NOISE +
  /* glsl */ `
      uniform float t; varying vec3 vN; varying vec3 vV; varying float vD;
      void main(){ vec3 n=normalize(position); float d=snoise(n*1.6+vec3(0.,t*.55,t*.3)); vD=d;
        vec3 p=position+normal*d*.35*${num(radius)}*.32;
        vec4 mv=modelViewMatrix*vec4(p,1.); vN=normalize(normalMatrix*normal); vV=normalize(-mv.xyz); gl_Position=projectionMatrix*mv; }`;

export const coreFragment = /* glsl */ `
      uniform float heat,op; uniform vec3 cold,amber,hot; varying vec3 vN; varying vec3 vV; varying float vD;
      void main(){ float f=pow(1.-max(dot(vN,vV),0.),2.2); vec3 c=mix(amber*.34,amber*.95,smoothstep(-.45,.25,vD)); c=mix(c,hot*1.1,smoothstep(.25,.75,vD)); c=mix(c,hot*1.15,f*.8);
        c=mix(cold*1.1,c,heat); gl_FragColor=vec4(c,op); }`;
