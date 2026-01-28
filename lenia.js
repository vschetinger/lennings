const prefix = `#version 300 es
precision highp float;

uniform float dt;         //! slider(0.1, [0.01, 2.0], 0.01)
uniform float repulsion;  //! slider(1.0, [0.0, 3.0], 0.1)
uniform float m1;         //! slider(1.27, [0.0, 10.0], 0.01, updateW1)
uniform float s1;         //! slider(1.0, [0.5, 3.0], 0.01, updateW1)
uniform float w1;         //! updateW1();
uniform float m2;         //! slider(0.6, [0.0, 2.0], 0.01)
uniform float s2;         //! slider(0.2, [0.01, 0.5], 0.01)
uniform sampler2D state;      //! this.src.attachments[0]
uniform sampler2D state1;     //! this.src.attachments[1]
uniform sampler2D fieldU;     //! this.fieldU.attachments[0]
uniform sampler2D fieldR;     //! this.fieldR.attachments[0]
uniform sampler2D selectBuf;  //! this.selectBuf.attachments[0]
uniform sampler2D resourceTex;    //! this.resourceTex.attachments[0]
uniform sampler2D prefBuf;        //! this.prefBuf.attachments[0]
uniform float dishR;          //! 75.0
uniform float fieldScale;     //! 1.0
// Life cycle parameters (controlled via left panel, not auto-sliders)
uniform float resourceAttraction; //! 1.0
uniform float resourceDecay;      //! 0.01
uniform float energyDecay;        //! 0.001
uniform float feedRate;           //! 0.1
uniform float hungerMultiplier;   //! 2.0
uniform float reproThreshold;     //! 0.8
uniform float reproCost;          //! 0.4
uniform float deathDissolveRadius; //! 5.0
uniform float deathEnergyAmount;  //! 0.3
uniform float deathEnergyFalloff; //! 2.0
uniform float deathAgeScale;      //! 0.002

uniform float baseFreq;       //! slider(100.0, [20.0, 1000.0], 1.0)
uniform float clockExp;       //! slider(4.0, [1.0, 10.0], 0.1)
uniform float audioVolume;    //! slider(0.1, [0.0, 3.0], 0.1)
uniform float pointsAlpha;    //! slider(1.0, [0.0, 1.0], 0.1)
uniform float fieldGE;        //! slider(-1.0, [-1.0, 1.0], 0.1)

uniform float viewExtent;
uniform float viewAspect;
uniform vec2  viewCenter;
uniform bool selectedOnly;

uniform vec2 touchPos;
uniform float touchRadius;

const float tau = 6.28318530718f;

vec2 kernel(float r, float m, float s) {
    float c = (r-m)/s;
    float y = exp(-c*c);
    float dy_dr = -2.0*c*y/s;
    return vec2(y, dy_dr);
}
vec2 wld2scr(vec2 p) {
    vec2 extent = viewExtent*vec2(1.0, 1.0/viewAspect);
    return 2.0*(p-viewCenter)/extent;
}
vec2 scr2wld(vec2 p) {
    vec2 extent = viewExtent*vec2(1.0, 1.0/viewAspect);
    return 0.5*p*extent + viewCenter;
}
vec3 getLightDir(vec2 wldPos) {
    return vec3(0.6, 0.6, 0.6);
    //return normalize(vec3(wldPos-touchPos, viewExtent*0.5));
}
bool isTouched(vec2 pos) {
    return length(pos-touchPos)<touchRadius;
}
bool isAlive(vec4 state) { 
    return state.x > -10000.0;
}
`;
const vp_prefix = prefix+`
in vec2 quad;
in ivec2 idx;
out vec2 uv;

struct Particle {
  bool visible;
  vec3 color;
  vec2 pos;
  float radius;
  float clock;
  vec3 pref;  // RGB resource preferences
};

Particle getParticle() {
    Particle res;
    vec4 p = texelFetch(state, idx, 0);
    vec4 p1 = texelFetch(state1, idx, 0);
    vec4 pref = texelFetch(prefBuf, idx, 0);
    float repulsionPotential = p1.x;
    float particleEnergy = p1.y;  // Life energy (0 to 1)
    bool selected = texelFetch(selectBuf, idx, 0).x > 0.0;
    res.visible = selectedOnly ? selected : isAlive(p);
    if (!res.visible) 
      return res;
    res.pos = p.xy;
    res.pref = normalize(abs(pref.rgb) + 0.01);
    
    // Color by preference, dimmed by energy level
    float energyBrightness = 0.4 + 0.6 * clamp(particleEnergy, 0.0, 1.0);
    res.color = res.pref * energyBrightness;
    
    res.clock = p1.w;
    if (!selectedOnly) {
        if (selected) {res.color = vec3(1.5, 0.1, 0.1);}
        else if (isTouched(res.pos)) {res.color = vec3(1.5, 0.5, 0.5);}
    }
    
    // Radius based on repulsion and energy - smaller when hungry
    float baseRadius = (0.25 + 0.75/(repulsionPotential*2.0))*0.5;
    float energyScale = 0.6 + 0.4 * clamp(particleEnergy, 0.0, 1.0);
    res.radius = baseRadius * energyScale;
    //res.radius *= cos(res.clock*tau)*0.5+0.5;
    return res;
}

`;
const fp_prefix = prefix+` in vec2 uv;
layout(location = 0) out vec4 out0;
layout(location = 1) out vec4 out1;`;

function calcNormCoef(m, s) {
    const dr = 0.1*s;
    let acc = 0.0, prev=null;
    for (let r = Math.max(m-s*3.0, 0.0); r<m+s*3.0; r+=dr) {
        let y = (r-m)/s;
        let v = r*Math.exp(-y*y);
        if (prev!=null) acc += (prev+v)*0.5;
        prev = v;
    }
    return 1.0 / (acc*dr*2.0*Math.PI);
}

class ParticleLenia {

    constructor(gl, gui) {
        this.gl = gl;
        this.U = {};
        this.programs = {};
        this.dim_n = 2;
        this.state_size = [32, 16];
        const [sx, sy] = this.state_size;
        this.max_point_n = sx*sy;

        this.geom = twgl.createBufferInfoFromArrays(gl, {
            quad: { data: [-1,-1, -1,1, 1,-1, 1,1], numComponents: 2, divisor: 0 },
            idx: {
                data: new Int16Array(this.max_point_n*2).map((a, i) => i%2 ? (i>>1)/sx|0 : (i>>1)%sx),
                numComponents: 2, divisor: 1
            }
        });

        [this.src, this.dst] = [0, 1].map(
            ()=>twgl.createFramebufferInfo(gl, [{internalFormat: gl.RGBA32F}, {internalFormat: gl.RGBA32F}], sx, sy ));
        this.fieldFormat = [{minMag: gl.LINEAR, internalFormat: gl.RGBA16F}];
        this.fieldU = twgl.createFramebufferInfo(gl, this.fieldFormat, 256, 256);
        this.fieldR = twgl.createFramebufferInfo(gl, this.fieldFormat, 512, 512);
        this.selectBuf = twgl.createFramebufferInfo(gl, [{}], sx, sy);
        
        // Preferences buffer for RGB resource preferences per particle (double-buffered for reproduction)
        this.prefBuf = twgl.createFramebufferInfo(gl, [{internalFormat: gl.RGBA32F}], sx, sy);
        this.prefBufDst = twgl.createFramebufferInfo(gl, [{internalFormat: gl.RGBA32F}], sx, sy);
        
        // Resource texture for RGBA environmental fields (double-buffered for consumption)
        this.resourceFormat = [{minMag: gl.LINEAR, internalFormat: gl.RGBA16F}];
        this.resourceTex = twgl.createFramebufferInfo(gl, this.resourceFormat, 512, 512);
        this.resourceTexDst = twgl.createFramebufferInfo(gl, this.resourceFormat, 512, 512);

        this.setupUniforms(gui);
    }

    get dishR() { return this.U.dishR; }
    
    fetchState() {
        const gl = this.gl;
        const [sx, sy] = this.state_size;
        const select = new Uint8ClampedArray(sx*sy*4);
        const state0 = new Float32Array(sx*sy*4);
        const state1 = new Float32Array(sx*sy*4);
        twgl.bindFramebufferInfo(gl, this.src);
        gl.readBuffer(gl.COLOR_ATTACHMENT1)
        gl.readPixels(0, 0, sx, sy, gl.RGBA, gl.FLOAT, state1);
        gl.readBuffer(gl.COLOR_ATTACHMENT0)
        gl.readPixels(0, 0, sx, sy, gl.RGBA, gl.FLOAT, state0);
        twgl.bindFramebufferInfo(gl, this.selectBuf);
        gl.readPixels(0, 0, sx, sy, gl.RGBA, gl.UNSIGNED_BYTE, select);
        twgl.bindFramebufferInfo(gl, null); 
        return {state0, state1, select};
    }
    
    pushState(s) {
        const gl = this.gl;
        const [sx, sy] = this.state_size;
        gl.bindTexture(gl.TEXTURE_2D, this.src.attachments[0])
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, sx, sy, gl.RGBA, gl.FLOAT, s.state0);
        gl.bindTexture(gl.TEXTURE_2D, this.src.attachments[1])
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, sx, sy, gl.RGBA, gl.FLOAT, s.state1);
        gl.bindTexture(gl.TEXTURE_2D, this.selectBuf.attachments[0])
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, sx, sy, gl.RGBA, gl.UNSIGNED_BYTE, s.select);
    }

    captureCreature() {
        const {dim_n} = this;
        const {state0, select} = this.fetchState();
        const points = [];
        let x0=Infinity, y0=Infinity, x1=-Infinity, y1=-Infinity;
        for (let i=0; i<this.max_point_n*4; i+=4) {
            if ((state0[i] < -10000) || (select[i]==0))
                continue;
            const x=state0[i], y=state0[i+1];
            points.push(x, y);
            x0=Math.min(x0, x); y0=Math.min(y0, y);
            x1=Math.max(x1, x); y1=Math.max(y1, y);
        }
        if (points.length==0) return;
        const cx=(x0+x1)/2, cy=(y0+y1)/2;
        for (let i=0; i<points.length; i+=dim_n) {
            points[i]   = parseFloat((points[i]  -cx).toPrecision(5));
            points[i+1] = parseFloat((points[i+1]-cy).toPrecision(5));
        }
        const U = this.U;
        const data =  {dt:U.dt, dim_n, m1:U.m1, s1:U.s1, w1:U.w1, m2:U.m2, s2:U.s2, 
            repulsion:U.repulsion, points};
        return {data, center: [cx, cy], extent: Math.max(x1-x0+2.0, y1-y0+10.0)};
    } 

    pasteCreature(c, x, y, selected=0) {
        const s = this.fetchState();
        const [sx, sy] = this.state_size;
        s.state0.fill(-20000);
        s.state1.fill(0);
        s.select.fill(0);
        for (let i=0,j=0; i<c.points.length; i += c.dim_n, j+=4) {
            s.state0[j]   = s.state0[j+2] = x+c.points[i];
            s.state0[j+1] = s.state0[j+3] = y+c.points[i+1];
            s.select[j] = 255*selected;
        }
        this.pushState(s);
        for (const name of 'dt m1 s1 w1 m2 s2 repulsion'.split(' ')) {
            this.U[name] = c[name];
        }
        this.step(); // single update to populate the repulsion field
    }
    
    setupUniforms(gui) {
        const U = this.U;
        function updateW1() {
            return U.w1 = calcNormCoef(U.m1, U.s1);
        }
        let name;
        function slider(value, range, step, cb=()=>{}) {
            U[name] = value;
            const [lo, hi] = range;
            gui.add(U, name, lo, hi, step).onChange(cb);
            return value;
        }
        for (const s of prefix.split('\n')) {
            const [decl, js_line] = s.split('//!');
            if (js_line) {
                name = decl.match(/\w+\s+\w+\s+(\w+)/)[1];
                U[name] = eval(js_line);
            }
        }
    }

    reset(n='max') {
        if (n=='max')
            n = this.max_point_n;
        this.clearSelection();
        this.runProgram(`
        uniform int n;
        void main() {
            ivec2 ij = ivec2(gl_FragCoord.xy);
            ivec2 sz = textureSize(state, 0);
            int idx = ij.y*sz.x+ij.x;
            if (idx>=n) {
                out0 = vec4(-20000);
                out1 = vec4(0.0);
                return;
            }
            float r = sqrt(float(idx)*0.5+0.25);
            float a = 2.4*float(idx);
            vec2 p = vec2(sin(a)*r, cos(a)*r);
            out0 = vec4(p, p);
            // Initialize state1: (rep, energy, age, clock)
            // Start with full energy (1.0), age 0
            out1 = vec4(0.5, 1.0, 0.0, 0.0);
        }`, {dst:this.dst}, {n});
        this.flipBuffers();
        
        // Initialize random RGB preferences for each particle
        this.runProgram(`
        uniform int n;
        void main() {
            ivec2 ij = ivec2(gl_FragCoord.xy);
            ivec2 sz = textureSize(state, 0);
            int idx = ij.y*sz.x+ij.x;
            if (idx>=n) {
                out0 = vec4(0.0);
                return;
            }
            // Generate pseudo-random RGB preferences
            float fi = float(idx);
            vec3 pref = vec3(
                fract(sin(fi*12.9898)*43758.5453),
                fract(sin(fi*78.233)*43758.5453),
                fract(sin(fi*45.164)*43758.5453)
            );
            // Normalize to ensure sum is meaningful
            pref = normalize(pref + 0.1);
            out0 = vec4(pref, 1.0);
        }`, {dst:this.prefBuf}, {n});
    }

    setPoint(i, xy) {
        this.runProgram(`
        uniform int i;
        uniform vec2 xy;
        void main() {
            ivec2 ij = ivec2(gl_FragCoord.xy);
            ivec2 sz = textureSize(state, 0);
            int idx = ij.y*sz.x+ij.x;
            out0 = idx==i ? vec4(xy, xy) : texelFetch(state, ij, 0);
            out1 = idx==i ? vec4(0.0)    : texelFetch(state1, ij, 0);
        }`, {dst:this.dst}, {i, xy});
        this.flipBuffers();
    }

    step({clockRate=0.0, paused=false, attractPos=[0, 0], attractRadius=0}={}) {
        this.U.touchPos = attractPos;
        this.U.touchRadius = attractRadius;
        this.runProgram(`
        uniform float clockRate;
        uniform bool paused;
        vec4 updateClock(vec4 s) {
            float myEnergy = s.y;
            float rate = exp2(myEnergy*clockExp);
            float clock = mod(s.w + clockRate*rate, 1.0);
            return vec4(s.xyz, clock);
        }
        
        // Sample resource field value weighted by particle preferences
        float sampleResource(vec2 wldPos, vec3 pref) {
            vec2 resUV = (wldPos / dishR) * 0.5 + 0.5;
            vec4 res = texture(resourceTex, resUV);
            return dot(pref, res.rgb) * res.a;
        }
        
        void main() {
            ivec2 ij = ivec2(gl_FragCoord.xy);
            ivec2 sz = textureSize(state, 0);
            out0 = texelFetch(state, ij, 0);
            if (!isAlive(out0)) {
                out1 = vec4(0.0);
                return;
            }
            out1 = texelFetch(state1, ij, 0);
            
            // Read life cycle state: state1 = (rep, energy, age, clock)
            float myEnergy = out1.y;
            float myAge = out1.z;
            
            if (paused) {
                out1 = updateClock(out1);
                return;
            }
            
            // Increment age
            myAge += 1.0;
            
            // Passive energy decay
            myEnergy -= energyDecay;
            
            vec2 pos=out0.xy;
            if (isTouched(pos)) {
                vec2 d = normalize(touchPos-pos);
                pos += d*0.01;
            }
            vec2 repDir=vec2(0.0), gv=vec2(0.0);
            float field=0.0, rep=0.5;
            float dmin=m1-3.0*s1, dmax=m1+3.0*s1;
            for (int i=0; i<sz.y; ++i)
            for (int j=0; j<sz.x; ++j) {
                vec4 other = texelFetch(state, ivec2(j, i), 0);
                if (!isAlive(other)) continue;
                vec2 r = other.xy-pos;
                float d = length(r);
                if (d<1e-8) {
                    // unglue stuck particles
                    if (j!=ij.x || i!=ij.y) {
                        pos += vec2(ij)*0.001;
                    }
                    continue;
                }
                r /= d;
                if (d<1.0) {
                    float f = 1.0-d;
                    repDir -= f*r; 
                    rep += 0.5*f*f;
                }
                if (d>dmin && d<dmax) {
                    vec2 v_dv = kernel(d, m1, s1);
                    field += v_dv.x;
                    gv += v_dv.y*r;
                }
            }
            field *= w1; gv *= w1;
            vec2 a_da = kernel(field, m2, s2);
            vec2 dpos = repDir*repulsion-a_da.y*gv;
            
            // Resource field attraction - compute gradient via finite differences
            vec3 myPref = normalize(abs(texelFetch(prefBuf, ij, 0).rgb) + 0.01);
            float texelSize = dishR / 256.0;  // World-space size of gradient sample
            float rC = sampleResource(pos, myPref);
            float rL = sampleResource(pos - vec2(texelSize, 0.0), myPref);
            float rR = sampleResource(pos + vec2(texelSize, 0.0), myPref);
            float rD = sampleResource(pos - vec2(0.0, texelSize), myPref);
            float rU = sampleResource(pos + vec2(0.0, texelSize), myPref);
            vec2 resourceGrad = vec2(rR - rL, rU - rD) / (2.0 * texelSize);
            
            // Feed on resources - gain energy from current position
            float foodValue = rC;
            myEnergy += foodValue * feedRate;
            
            // Hunger multiplier - low energy = stronger attraction to food
            float hungerFactor = 1.0 + (1.0 - clamp(myEnergy, 0.0, 1.0)) * hungerMultiplier;
            dpos += resourceGrad * resourceAttraction * hungerFactor;
            
            // Clamp energy to valid range
            myEnergy = clamp(myEnergy, 0.0, 1.0);
            
            vec2 prevPos = out0.zw;
            pos += (pos - prevPos)*0.5 + dpos*0.5*dt;
            pos /= max(1.0, length(pos)/dishR);
            
            // Update clock based on energy
            float clock = mod(out1.w + clockRate * exp2(myEnergy * clockExp), 1.0);
            
            out0 = vec4(pos, out0.xy);
            // Store: (repulsion, energy, age, clock)
            out1 = vec4(rep, myEnergy, myAge, clock);
        }`, {dst:this.dst}, {clockRate, paused});
        this.flipBuffers();
    }

    renderAudio(target, viewport) {
        this.runProgram(`
        uniform sampler2D pstate1;
        float osc(float t) {
            return abs(1.0-mod(t, 1.0)*2.0)*2.0-1.0;
        }
        vec2 osc2(float t) {
            return vec2(osc(t), osc(t+0.25));
        }
        void main() {
            ivec2 sz = textureSize(state, 0);
            float count = 1e-5, forceAcc = 0.0;
            out0 = vec4(0.0);
            for (int i=0; i<sz.y; ++i)
            for (int j=0; j<sz.x; ++j) {
                vec4 s0 = texelFetch(pstate1, ivec2(j, i), 0);
                vec4 s1 = texelFetch(state1, ivec2(j, i), 0);
                if (s0.w == s1.w) continue;
                if (s1.w<s0.w) s1.w += 1.0;
                vec4 s = mix(s0, s1, uv.x);
                vec2 v = osc2(s.w*baseFreq)+osc2(s.w*(baseFreq+1.0));
                float force = s.z;
                forceAcc += force;
                count += 1.0;
                out0.xy += v*force;
            }
            out0 = audioVolume*out0/max(pow(count, 0.25), forceAcc*0.5);
        }`, {dst:target, viewport}, {pstate1:this.dst.attachments[1]});
    }

    visAudio(target, audioTex) {
        this.runProgram(`
        uniform sampler2D audioTex;
        void main() {
            vec2 v = texture(audioTex, uv).xy;
            float y = uv.y*2.0-1.0;
            out0 = vec4(kernel(y, v.x, 0.01).x, kernel(y, v.y, 0.01).x, 0.0, 0.0);
            
        }`, {dst:target,blend:[gl.ONE, gl.ONE]}, {audioTex})
    }

    select(pos, radius) {
        this.U.touchPos = pos;
        this.U.touchRadius = radius;
        this.runProgram(`void main() {
            vec2 pos = texture(state, uv).xy;
            out0.x = float(isTouched(pos));
        }`, {dst:this.selectBuf, blend:[gl.ONE, gl.ONE]});
    }

    clearSelection() {
        twgl.bindFramebufferInfo(gl, this.selectBuf);
        gl.clear(gl.COLOR_BUFFER_BIT); 
        twgl.bindFramebufferInfo(gl, null);
    }

    clearResources() {
        const gl = this.gl;
        twgl.bindFramebufferInfo(gl, this.resourceTex);
        gl.clear(gl.COLOR_BUFFER_BIT);
        twgl.bindFramebufferInfo(gl, this.resourceTexDst);
        gl.clear(gl.COLOR_BUFFER_BIT);
        twgl.bindFramebufferInfo(gl, null);
    }

    async loadResourceImage(imageSource) {
        const gl = this.gl;
        let img;
        
        if (imageSource instanceof HTMLImageElement || imageSource instanceof HTMLCanvasElement) {
            img = imageSource;
        } else {
            // It's a URL string
            img = new Image();
            img.crossOrigin = "anonymous";
            await new Promise((resolve, reject) => {
                img.onload = resolve;
                img.onerror = reject;
                img.src = imageSource;
            });
        }
        
        // Create a canvas to process the image and extract RGBA
        const canvas = document.createElement('canvas');
        canvas.width = 512;
        canvas.height = 512;
        const ctx = canvas.getContext('2d');
        // Flip vertically to match WebGL coordinate system
        ctx.translate(0, 512);
        ctx.scale(1, -1);
        ctx.drawImage(img, 0, 0, 512, 512);
        const imageData = ctx.getImageData(0, 0, 512, 512);
        
        // Convert to float array for RGBA16F texture
        const floatData = new Float32Array(512 * 512 * 4);
        for (let i = 0; i < imageData.data.length; i++) {
            floatData[i] = imageData.data[i] / 255.0;
        }
        
        // Store the original float data for reloading later
        this.originalResourceData = floatData.slice(); // Make a copy
        
        // Upload to resource texture
        this._uploadResourceData(floatData);
    }
    
    _uploadResourceData(floatData) {
        const gl = this.gl;
        gl.bindTexture(gl.TEXTURE_2D, this.resourceTex.attachments[0]);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, 512, 512, 0, gl.RGBA, gl.FLOAT, floatData);
        gl.bindTexture(gl.TEXTURE_2D, null);
        
        gl.bindTexture(gl.TEXTURE_2D, this.resourceTexDst.attachments[0]);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, 512, 512, 0, gl.RGBA, gl.FLOAT, floatData);
        gl.bindTexture(gl.TEXTURE_2D, null);
    }
    
    reloadResourceImage() {
        // Reload the original resource image if one was loaded
        if (this.originalResourceData) {
            this._uploadResourceData(this.originalResourceData);
            return true;
        }
        return false;
    }
    
    hasLoadedResource() {
        return !!this.originalResourceData;
    }

    consumeResources() {
        const gl = this.gl;
        
        // Step 1: Copy current resource texture to dst buffer
        this.runProgram(`
        void main() {
            out0 = texture(resourceTex, uv);
        }`, {dst: this.resourceTexDst});
        
        // Step 2: Render consumption + subtraction in one pass to resourceTex
        // Reading from resourceTexDst, writing to resourceTex
        this.runProgram(`
        uniform sampler2D srcResourceTex;
        void main() {
            vec4 res = texture(srcResourceTex, uv);
            
            // Accumulate consumption from all particles
            float consumption = 0.0;
            ivec2 sz = textureSize(state, 0);
            vec2 wldPos = (uv - 0.5) * 2.0 * dishR;  // Map UV to world position
            
            for (int i = 0; i < sz.y; ++i)
            for (int j = 0; j < sz.x; ++j) {
                vec4 p = texelFetch(state, ivec2(j, i), 0);
                if (!isAlive(p)) continue;
                float d = length(wldPos - p.xy);
                if (d < 5.0) {
                    consumption += exp(-d*d / 4.0) * resourceDecay;
                }
            }
            
            // Deplete only alpha, keep RGB intact
            out0 = vec4(res.rgb, max(0.0, res.a - consumption));
        }`, {dst: this.resourceTex}, {srcResourceTex: this.resourceTexDst.attachments[0]});
    }

    processDeaths() {
        const gl = this.gl;
        
        // Step 1: Copy current resource texture to dst buffer (used as source)
        this.runProgram(`
        void main() {
            out0 = texture(resourceTex, uv);
        }`, {dst: this.resourceTexDst});
        
        // Step 2: Render death dissolution from dying particles (energy <= 0) to resourceTex
        // This adds the particle's color to the resource field where it dies
        this.runProgram(`
        uniform sampler2D srcResourceTex;
        void main() {
            // Start with existing resource
            vec4 res = texture(srcResourceTex, uv);
            
            // Add dissolution from dying particles
            ivec2 sz = textureSize(state, 0);
            vec2 wldPos = (uv - 0.5) * 2.0 * dishR;  // Map UV to world position
            
            vec3 addedColor = vec3(0.0);
            float addedAlpha = 0.0;
            
            for (int i = 0; i < sz.y; ++i)
            for (int j = 0; j < sz.x; ++j) {
                vec4 p = texelFetch(state, ivec2(j, i), 0);
                vec4 s1 = texelFetch(state1, ivec2(j, i), 0);
                float particleEnergy = s1.y;
                float age = s1.z;
                
                if (!isAlive(p)) continue;
                if (particleEnergy > 0.0) continue;  // Not dying
                
                // This particle is dying - calculate dissolution
                float d = length(wldPos - p.xy);
                
                // Parametric radius: base + age contribution
                float radius = deathDissolveRadius * (1.0 + age * deathAgeScale);
                
                if (d < radius * 2.0) {
                    // Parametric falloff distribution: exp(-d^falloff / radius^falloff)
                    // falloff=2 is Gaussian, <2 is softer/wider, >2 is sharper/more concentrated
                    float normalizedDist = d / radius;
                    float falloffTerm = pow(normalizedDist, deathEnergyFalloff);
                    float intensity = exp(-falloffTerm) * deathEnergyAmount * min(age * deathAgeScale, 0.5);
                    
                    vec3 pref = texelFetch(prefBuf, ivec2(j, i), 0).rgb;
                    addedColor += pref * intensity;
                    addedAlpha += intensity;
                }
            }
            
            // Blend new dissolution with existing resources
            out0 = vec4(res.rgb + addedColor, min(res.a + addedAlpha, 1.0));
        }`, {dst: this.resourceTex}, {srcResourceTex: this.resourceTexDst.attachments[0]});
        
        // Step 3: Mark dead particles (energy <= 0) as inactive
        this.runProgram(`
        void main() {
            ivec2 ij = ivec2(gl_FragCoord.xy);
            out0 = texelFetch(state, ij, 0);
            out1 = texelFetch(state1, ij, 0);
            
            // Check if particle should die (energy <= 0)
            if (isAlive(out0) && out1.y <= 0.0) {
                out0 = vec4(-20000.0);  // Mark as dead
                out1 = vec4(0.0);
            }
        }`, {dst: this.dst});
        this.flipBuffers();
    }

    processReproduction() {
        // GPU-based reproduction:
        // 1. First pass: Mark particles ready to reproduce and reduce their energy
        // 2. Second pass: Empty slots look for nearby reproducing parents
        
        // Pass 1: Mark parents and deduct energy
        this.runProgram(`
        void main() {
            ivec2 ij = ivec2(gl_FragCoord.xy);
            out0 = texelFetch(state, ij, 0);
            out1 = texelFetch(state1, ij, 0);
            
            if (!isAlive(out0)) return;
            
            // Check if ready to reproduce (energy >= threshold)
            if (out1.y >= reproThreshold) {
                // Mark for reproduction by setting high w value (temporary flag)
                // and deduct energy cost
                out1 = vec4(out1.x, out1.y - reproCost, out1.z, 999.0);
            }
        }`, {dst: this.dst});
        this.flipBuffers();
        
        // Pass 2: Empty slots become children of nearby reproducing parents
        this.runProgram(`
        // Simple hash function for pseudo-random
        float hash(float n) { return fract(sin(n) * 43758.5453); }
        
        void main() {
            ivec2 ij = ivec2(gl_FragCoord.xy);
            ivec2 sz = textureSize(state, 0);
            int myIdx = ij.y * sz.x + ij.x;
            
            out0 = texelFetch(state, ij, 0);
            out1 = texelFetch(state1, ij, 0);
            
            // Only process empty slots
            if (isAlive(out0)) {
                // Clear reproduction flag if set
                if (out1.w > 900.0) {
                    out1 = vec4(out1.xyz, 0.0);
                }
                return;
            }
            
            // Find a reproducing parent
            vec4 bestParent = vec4(0.0);
            vec4 bestParentState = vec4(0.0);
            vec3 bestPref = vec3(0.0);
            int bestParentIdx = -1;
            float bestDist = 1e10;
            
            for (int i = 0; i < sz.y; ++i)
            for (int j = 0; j < sz.x; ++j) {
                int idx = i * sz.x + j;
                vec4 p = texelFetch(state, ivec2(j, i), 0);
                vec4 s1 = texelFetch(state1, ivec2(j, i), 0);
                
                if (!isAlive(p)) continue;
                if (s1.w < 900.0) continue;  // Not reproducing
                
                // Pseudo-random selection based on slot index
                float selectionScore = hash(float(idx) + float(myIdx) * 0.1);
                if (selectionScore < bestDist) {
                    bestDist = selectionScore;
                    bestParent = p;
                    bestParentState = s1;
                    bestParentIdx = idx;
                    bestPref = texelFetch(prefBuf, ivec2(j, i), 0).rgb;
                }
            }
            
            // If found a parent, become its child
            if (bestParentIdx >= 0) {
                // Spawn near parent with small random offset
                float angle = hash(float(myIdx) * 12.34) * 6.283;
                float dist = 1.0 + hash(float(myIdx) * 56.78) * 2.0;
                vec2 offset = vec2(cos(angle), sin(angle)) * dist;
                vec2 childPos = bestParent.xy + offset;
                childPos /= max(1.0, length(childPos) / dishR);  // Keep in bounds
                
                out0 = vec4(childPos, childPos);  // Position
                // Child starts with half of parent's reproduction cost worth of energy
                out1 = vec4(0.5, reproCost * 0.5, 0.0, 0.0);  // (rep, energy, age, clock)
            }
        }`, {dst: this.dst});
        this.flipBuffers();
        
        // Pass 3: Initialize child preferences (mutation from parent)
        // Use double-buffer: read from prefBuf, write to prefBufDst
        this.runProgram(`
        uniform sampler2D srcPrefBuf;
        float hash(float n) { return fract(sin(n) * 43758.5453); }
        
        void main() {
            ivec2 ij = ivec2(gl_FragCoord.xy);
            ivec2 sz = textureSize(state, 0);
            int idx = ij.y * sz.x + ij.x;
            
            vec4 currentPref = texelFetch(srcPrefBuf, ij, 0);
            vec4 p = texelFetch(state, ij, 0);
            vec4 s1 = texelFetch(state1, ij, 0);
            
            // If this is a new particle (age == 0 and energy > 0), give it mutated preferences
            if (isAlive(p) && s1.z < 1.0 && s1.y > 0.0) {
                // Find closest particle to inherit preferences from (likely parent)
                vec3 inheritedPref = vec3(0.5);
                float closestDist = 1e10;
                
                for (int i = 0; i < sz.y; ++i)
                for (int j = 0; j < sz.x; ++j) {
                    if (i == ij.y && j == ij.x) continue;
                    vec4 other = texelFetch(state, ivec2(j, i), 0);
                    vec4 otherS1 = texelFetch(state1, ivec2(j, i), 0);
                    if (!isAlive(other)) continue;
                    if (otherS1.z < 1.0) continue;  // Skip other newborns
                    
                    float d = length(other.xy - p.xy);
                    if (d < closestDist) {
                        closestDist = d;
                        inheritedPref = texelFetch(srcPrefBuf, ivec2(j, i), 0).rgb;
                    }
                }
                
                // Apply mutation
                float mutation = 0.1;
                vec3 noise = vec3(
                    hash(float(idx) * 11.11) - 0.5,
                    hash(float(idx) * 22.22) - 0.5,
                    hash(float(idx) * 33.33) - 0.5
                ) * mutation;
                
                vec3 childPref = normalize(max(inheritedPref + noise, vec3(0.01)));
                out0 = vec4(childPref, 1.0);
            } else {
                out0 = currentPref;
            }
        }`, {dst: this.prefBufDst}, {srcPrefBuf: this.prefBuf.attachments[0]});
        
        // Pass 4: Copy prefBufDst back to prefBuf
        this.runProgram(`
        uniform sampler2D srcPref;
        void main() {
            out0 = texelFetch(srcPref, ivec2(gl_FragCoord.xy), 0);
        }`, {dst: this.prefBuf}, {srcPref: this.prefBufDst.attachments[0]});
    }

    adjustFB(fb, width, height, attachments) {
        if (fb.width != width || fb.height != height)
            twgl.resizeFramebufferInfo(this.gl, fb, attachments, width, height);
    }

    render(target, {viewCenter=[0,0], viewExtent=50.0, 
            selectedOnly=false, flipUD=false,
            touchPos=[0,0], touchRadius=0.0}={}) {
        const {width, height} = target || this.gl.canvas;
        const viewAspect = width / Math.max(1.0, height);
        const minDim = Math.min(width, height)
        const fieldScale = Math.min(32.0*viewExtent/this.U.s1/minDim, 1.0);
        Object.assign(this.U, {viewCenter, viewExtent, viewAspect, selectedOnly,
            touchPos, touchRadius, fieldScale});
        this.adjustFB(this.fieldU, Math.round(width/4), Math.round(height/4), this.fieldFormat);
        this.adjustFB(this.fieldR, Math.round(width/2), Math.round(height/2), this.fieldFormat);
        // accumulate field U
        this.runProgram(`void main() {
            uv = quad*(m1+s1*4.0);
            Particle p = getParticle();
            gl_Position = p.visible ? vec4(wld2scr(p.pos+uv)*fieldScale, 0.0, 1.0) : vec4(0.0);
        }
        //FRAG
        void main() {
            float r = length(uv);
            vec2 dir = uv/r;
            vec2 U_dU = kernel(r, m1, s1)*w1;
            vec2 gradU = dir*U_dU.y;
            out0 = vec4(gradU, U_dU.x, 0.0);
        }`, {n:this.max_point_n, clear: true, dst:this.fieldU, blend:[gl.ONE, gl.ONE]});
        // accumulate field R
        this.runProgram(`void main() {
            uv = quad;
            Particle p = getParticle();
            gl_Position = p.visible ? vec4(wld2scr(p.pos+uv)*fieldScale, 0.0, 1.0) : vec4(0.0);
        }
        //FRAG
        void main() {
            float r = length(uv);
            vec2 dir = uv/r;
            float rep = max(1.0-r, 0.0);
            float R = 0.5*repulsion*rep*rep;
            vec2 gradR = -repulsion*rep*dir;
            out0 = vec4(gradR, R, 0.0);
        }`, {n:this.max_point_n, clear: true, dst:this.fieldR, blend:[gl.ONE, gl.ONE]});        
        // render field background
        this.runProgram(`
        uniform bool flipUD;
        void main() {
            vec2 p = flipUD ? vec2(uv.x, 1.0-uv.y) : uv;
            vec2 fieldP = (p-0.5)*fieldScale+0.5;
            vec4 U = texture(fieldU, fieldP);
            vec4 R = texture(fieldR, fieldP);
            vec2 G_dG = kernel(U.z, m2, s2);
            vec2 gradG = U.xy*G_dG.y;
            float E = R.z-G_dG.x;
            vec2 gradE = R.xy-gradG;
            vec2 g = fieldGE>0.0? gradE*fieldGE : -gradG*fieldGE;
            vec3 normal = normalize(vec3(-g, 1.0));
            vec2 wldPos = scr2wld(p*2.0-1.0);
            vec3 lightDir = getLightDir(wldPos);
            float light = 0.5+0.5*max(dot(normal, lightDir), 0.0);

            float Es = E+kernel(0.0, m2, s2).x;
            vec3 colorE = mix(vec3(1.0), Es>0.0?vec3(0.7,0,0):vec3(0.2,0.8,0.2), abs(Es));
            float c = sqrt(U.z);
            vec3 colorUG = mix(vec3(0.1, 0.1, 0.3), vec3(0.2, 0.7, 1.0), c);
            colorUG = mix(colorUG, vec3(0.9, 0.7, 0.1), G_dG.x*min(c*2.0, 1.0));
            vec3 bg = vec3(1.0);
            vec3 color = fieldGE>0.0? mix(bg, colorE, fieldGE) : mix( bg, colorUG, -fieldGE);

            // Blend resource texture - sample at world position mapped to resource UV
            vec2 resUV = (wldPos / dishR) * 0.5 + 0.5;
            vec4 resTex = texture(resourceTex, resUV);
            vec3 resColor = resTex.rgb;
            float resAlpha = resTex.a;
            // Blend resource color with terrain based on alpha
            color = mix(color, resColor * light, resAlpha * 0.8);

            out0 = vec4(vec3(light)*color, 1.0);
            if (isTouched(wldPos)) {
                out0.rgb = mix(out0.rgb, vec3(1.0), 0.1);
            }
        }`, {dst:target}, {flipUD});
        // render particles
        this.runProgram(`
        uniform bool flipUD;
        out vec3 color;
        out vec2 wldPos;
        void main() {
            uv = quad*1.1;
            Particle p = getParticle();
            if (!p.visible) {
              gl_Position = vec4(0.0);
              return;
            }
            wldPos = p.pos + uv*p.radius;
            color = p.color;
            gl_Position = vec4(wld2scr(wldPos), 0.0, 1.0);
            if (flipUD) gl_Position.y *= -1.0;
        }
        //FRAG
        in vec3 color;
        in vec2 wldPos;
        void main() {
            float r = length(uv);
            float a = smoothstep(0.9, 0.7, r);
            vec3 n = normalize(vec3(uv, 1.0));
            float v = max(dot(n, getLightDir(wldPos)),0.0)*0.9+0.1;
            float alpha = a*r*r;
            out0 = vec4(color*v*alpha, kernel(r, 0.8, 0.15)*0.2)*pointsAlpha;
        }`, {dst:target, n:this.max_point_n, blend:[gl.ONE, gl.ONE_MINUS_SRC_ALPHA]}, {flipUD});
    }

    flipBuffers() {
        [this.dst, this.src] = [this.src, this.dst];
        this.U.state = this.src.attachments[0];
        this.U.state1 = this.src.attachments[1];
    }

    runProgram(code, opt = {}, localUniforms={}) {
        if (!(code in this.programs)) {
            let [vp, fp] = code.split('//FRAG');
            if (!fp) {
                vp = 'void main() {uv=quad*.5+.5; gl_Position=vec4(quad,0.0,1.0);}';
                fp = code;
            }
            this.programs[code] = twgl.createProgramInfo(gl, [vp_prefix + vp, fp_prefix + fp]);
        }
        twgl.bindFramebufferInfo(gl, opt.dst);
        if (opt.viewport) {
            this.gl.viewport(...opt.viewport);
        }
        if (opt.dst) {
            const an = opt.dst.attachments.length;
            gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1].slice(0, an));
        }
        if (opt.clear) { gl.clear(gl.COLOR_BUFFER_BIT); }
        if (opt.blend) {
            gl.enable(gl.BLEND);
            const [sfactor, dfactor, eqation] = opt.blend;
            gl.blendFunc(sfactor, dfactor);
            gl.blendEquation(eqation || gl.FUNC_ADD)
        }
        const program = this.programs[code];
        gl.useProgram(program.program);
        twgl.setUniforms(program, {...this.U, ...localUniforms});
        twgl.setBuffersAndAttributes(gl, program, this.geom);
        twgl.drawBufferInfo(gl, this.geom, gl.TRIANGLE_STRIP, 4, 0, opt.n || 1);
        if (opt.blend) { gl.disable(gl.BLEND); }
    }
};