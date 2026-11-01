// The showcase's volumetric-looking core; geometry and reflections are supplied by Blender/Three.
export const orbVertex = `varying vec3 vP; varying vec3 vN; varying vec3 vV;
void main(){vP=position;vec4 p=modelViewMatrix*vec4(position,1.);vN=normalize(normalMatrix*normal);vV=normalize(-p.xyz);gl_Position=projectionMatrix*p;}`
export const orbFragment = `precision highp float;
uniform float time;uniform float energy;varying vec3 vP;varying vec3 vN;varying vec3 vV;
float hash(vec3 p){p=fract(p*.3183099+vec3(.17,.31,.47));p*=17.;return fract(p.x*p.y*p.z*(p.x+p.y+p.z));}
float noise(vec3 p){vec3 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
return mix(mix(mix(hash(i),hash(i+vec3(1,0,0)),f.x),mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),
mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y),f.z);}
float fbm(vec3 p){float s=0.,a=.55;for(int i=0;i<4;i++){s+=a*noise(p);p=p*2.03+vec3(3.1,1.7,2.8);a*=.5;}return s;}
void main(){vec3 p=vP*3.;float a=time*.12+p.y*.8;p.xz=mat2(cos(a),-sin(a),sin(a),cos(a))*p.xz;
float cloud=fbm(p+vec3(0.,time*.08,0.));float tendril=fbm(p*1.8+cloud*2.-vec3(time*.06,0.,0.));
float light=smoothstep(.38,.78,cloud*.65+tendril*.5);vec3 col=mix(vec3(.012,.025,.085),vec3(.055,.24,.48),light);
col=mix(col,vec3(.37,.18,.56),smoothstep(.52,.8,tendril)*.55);
float thread=pow(max(0.,1.-abs(cloud-.55)*12.),6.);col+=vec3(.18,.55,.78)*thread*(.35+energy*.3);
float edge=pow(1.-max(0.,dot(normalize(vN),normalize(vV))),2.);col+=vec3(.10,.24,.38)*edge;
gl_FragColor=vec4(col*(1.3+energy*.35),.83+edge*.13);}`

export const starVertex = `uniform float time;varying float brightness;
void main(){gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);gl_PointSize=2.8;brightness=.45+.3*sin(time*.7+position.y*15.+position.x*9.);}`
export const starFragment = `varying float brightness;
void main(){float r=length(gl_PointCoord-.5);float a=smoothstep(.5,.05,r);gl_FragColor=vec4(.65,.83,1.,a*brightness);}`
