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
uniform sampler2D trailTex;       //! this.trailTex.attachments[0]
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
uniform float reproMinAge;        //! 100.0
uniform float currentStep;        //! 0.0  // Global simulation step counter
uniform float deathDissolveRadius; //! 5.0
uniform float deathEnergyAmount;  //! 0.3
uniform float deathEnergyFalloff; //! 2.0
uniform float deathAgeScale;      //! 0.002
uniform float hueThreshold;       //! 30.0

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

// RGB to HSV conversion - returns vec3(hue, saturation, value) where hue is 0-1
vec3 rgb2hsv(vec3 c) {
    vec4 K = vec4(0.0, -1.0/3.0, 2.0/3.0, -1.0);
    vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
    vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
    float d = q.x - min(q.w, q.y);
    float e = 1.0e-10;
    return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
}

// Calculate angular distance between two hues (handles wraparound)
float hueDistance(float h1, float h2) {
    float diff = abs(h1 - h2);
    return min(diff, 1.0 - diff);  // Hue is circular, so wrap at 1.0
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

    constructor(gl, gui, paramMap = {}) {
        this.gl = gl;
        this.U = {};
        this.programs = {};
        this.paramMap = paramMap;  // Store paramMap for use in setupUniforms
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
        
        // Trail accumulation texture for particle path visualization
        this.trailTex = twgl.createFramebufferInfo(gl, 
            [{minMag: gl.LINEAR, internalFormat: gl.RGBA16F}], 1024, 1024);

        // Compressed reconstruction texture (will be created on demand)
        this.compressedReconstructionTex = null;
        this.compressedReconstructionProgram = null;  // Cached shader program

        // Global step counter for birthStep-based age calculation
        this.stepCount = 0;
        
        // Compressed reconstruction cache state
        this.compressedReconstruction = null;
        this.eatenPixelsCache = null;
        this.lastEatenCount = 0;
        this.lastReconstructionDims = null;
        this.reconstructionUpdateFrame = 0;  // Frame counter for periodic updates

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
    
    getAliveCount() {
        const gl = this.gl;
        const [sx, sy] = this.state_size;
        const buf = new Float32Array(sx * sy * 4);
        twgl.bindFramebufferInfo(gl, this.src);
        gl.readBuffer(gl.COLOR_ATTACHMENT0);
        gl.readPixels(0, 0, sx, sy, gl.RGBA, gl.FLOAT, buf);
        twgl.bindFramebufferInfo(gl, null);
        let count = 0;
        for (let i = 0; i < sx * sy; ++i) {
            const x = buf[i * 4];
            if (x > -10000.0) count++;  // same isAlive criterion
        }
        return count;
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

    // CPU-side reproduction step with per-parent child cap.
    // This is called infrequently (e.g. every K simulation steps) to avoid
    // heavy GPU readbacks every frame, and to guarantee that each parent
    // can produce at most `maxChildrenPerParent` offspring per reproduction step.
    cpuReproductionStep(maxChildrenPerParent = 2) {
        const { reproThreshold, reproMinAge, reproCost, dishR } = this.U;
        const currentStep = this.stepCount || 0;
        const { state0, state1, select } = this.fetchState();
        const [sx, sy] = this.state_size;
        const N = sx * sy;

        // Also fetch preference buffer so children can inherit/mutate parent color.
        const gl = this.gl;
        const prefBufData = new Float32Array(sx * sy * 4);
        twgl.bindFramebufferInfo(gl, this.prefBuf);
        gl.readPixels(0, 0, sx, sy, gl.RGBA, gl.FLOAT, prefBufData);
        twgl.bindFramebufferInfo(gl, null);

        const parents = [];
        const empties = [];

        for (let i = 0; i < N; ++i) {
            const base = i * 4;
            const x = state0[base + 0];
            const energy = state1[base + 1];
            const birthStep = state1[base + 2];
            const alive = x > -10000.0; // same isAlive criterion as shaders

            if (alive) {
                const age = currentStep - birthStep;
                if (energy >= reproThreshold && age >= reproMinAge) {
                    parents.push(i);
                }
            } else {
                empties.push(i);
            }
        }

        if (!parents.length || !empties.length || maxChildrenPerParent <= 0) {
            // Nothing to do; push state back unchanged so caller doesn't
            // have to special-case.
            this.pushState({ state0, state1, select });
            return;
        }

        // For each parent, assign up to maxChildrenPerParent empty slots.
        for (let pi = 0; pi < parents.length; ++pi) {
            if (!empties.length) break;
            const pIdx = parents[pi];
            const pBase = pIdx * 4;
            const px = state0[pBase + 0];
            const py = state0[pBase + 1];
            const prefBase = pBase;
            const parentR = prefBufData[prefBase + 0];
            const parentG = prefBufData[prefBase + 1];
            const parentB = prefBufData[prefBase + 2];

            let childrenForParent = 0;

            while (childrenForParent < maxChildrenPerParent && empties.length) {
                const emptyIdx = empties.pop();
                const cBase = emptyIdx * 4;

                // Sample a random offset around the parent, similar to the GPU logic.
                const angle = Math.random() * Math.PI * 2.0;
                const dist = 1.0 + Math.random() * 2.0;
                let cx = px + Math.cos(angle) * dist;
                let cy = py + Math.sin(angle) * dist;

                // Keep child within dish radius.
                const len = Math.hypot(cx, cy);
                if (len > dishR) {
                    const scale = dishR / len;
                    cx *= scale;
                    cy *= scale;
                }

                // Write child position (same layout as shaders: (pos, pos))
                state0[cBase + 0] = cx;
                state0[cBase + 1] = cy;
                state0[cBase + 2] = cx;
                state0[cBase + 3] = cy;

                // Initialize child life state:
                // (repulsion, energy, birthStep, clock)
                state1[cBase + 0] = 0.5;
                state1[cBase + 1] = reproCost * 0.5;
                state1[cBase + 2] = currentStep;
                state1[cBase + 3] = 0.0;

                // Inherit and slightly mutate parent preference color
                const childPrefBase = cBase;
                const mutation = 0.1;
                const mutate = () => (Math.random() - 0.5) * mutation;
                let cr = parentR + mutate();
                let cg = parentG + mutate();
                let cb = parentB + mutate();
                // Keep within [0,1] to avoid weird artifacts
                cr = Math.min(1.0, Math.max(0.0, cr));
                cg = Math.min(1.0, Math.max(0.0, cg));
                cb = Math.min(1.0, Math.max(0.0, cb));
                prefBufData[childPrefBase + 0] = cr;
                prefBufData[childPrefBase + 1] = cg;
                prefBufData[childPrefBase + 2] = cb;
                prefBufData[childPrefBase + 3] = 1.0;

                childrenForParent++;
            }

            if (childrenForParent > 0) {
                // Charge the parent a single reproduction cost for this step,
                // matching the original GPU semantics (one cost even if
                // multiple children are spawned).
                const b = pBase;
                state1[b + 1] = Math.max(0.0, state1[b + 1] - reproCost);
            }
        }

        this.pushState({ state0, state1, select });

        // Push updated preferences back to GPU
        gl.bindTexture(gl.TEXTURE_2D, this.prefBuf.attachments[0]);
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, sx, sy, gl.RGBA, gl.FLOAT, prefBufData);
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
        const paramMap = this.paramMap || {};
        
        // Helper to get parameter value from JSON with fallback
        function getParamValue(paramName, defaultValue) {
            const param = paramMap[paramName];
            if (param && param.value !== undefined) {
                return param.value;
            }
            return defaultValue;
        }
        
        function updateW1() {
            return U.w1 = calcNormCoef(U.m1, U.s1);
        }
        let name;
        function slider(value, range, step, cb=()=>{}) {
            // Use value from paramMap if available, otherwise use default
            const paramValue = getParamValue(name, value);
            U[name] = paramValue;
            const [lo, hi] = range;
            // Only create slider if this parameter is NOT in paramMap (JSON will create it)
            // Parameters in JSON will be handled by the dynamic GUI creation in index.html
            if (!paramMap[name]) {
                gui.add(U, name, lo, hi, step).onChange(cb);
            }
            return paramValue;
        }
        for (const s of prefix.split('\n')) {
            const [decl, js_line] = s.split('//!');
            if (js_line) {
                name = decl.match(/\w+\s+\w+\s+(\w+)/)[1];
                // Initialize from paramMap if available, otherwise use default from comment
                const defaultValue = eval(js_line);
                U[name] = getParamValue(name, defaultValue);
            }
        }
    }

    reset(n='max', center=[0,0]) {
        if (n=='max')
            n = this.max_point_n;
        n = Math.min(n, this.max_point_n);
        // Reset step counter when resetting simulation
        this.stepCount = 0;
        this.U.currentStep = 0;
        this.clearSelection();
        this.runProgram(`
        uniform int n;
        uniform vec2 center;
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
            vec2 p = center + vec2(sin(a)*r, cos(a)*r);
            out0 = vec4(p, p);
            // Initialize state1: (rep, energy, birthStep, clock)
            // Store current step as birthStep - age calculated as currentStep - birthStep
            out1 = vec4(0.5, 1.0, currentStep, 0.0);
        }`, {dst:this.dst}, {n, center});
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
            // When creating new particle, set birthStep to currentStep
            out1 = idx==i ? vec4(0.5, 1.0, currentStep, 0.0) : texelFetch(state1, ij, 0);
        }`, {dst:this.dst}, {i, xy});
        this.flipBuffers();
    }

    step({clockRate=0.0, paused=false, attractPos=[0, 0], attractRadius=0}={}) {
        this.U.touchPos = attractPos;
        this.U.touchRadius = attractRadius;
        // Increment global step counter (only when not paused)
        if (!paused) {
            this.stepCount++;
            this.U.currentStep = this.stepCount;
        }
        this.runProgram(`
        uniform float clockRate;
        uniform bool paused;
        vec4 updateClock(vec4 s) {
            float myEnergy = s.y;
            float rate = exp2(myEnergy*clockExp);
            float clock = mod(s.w + clockRate*rate, 1.0);
            return vec4(s.xyz, clock);
        }
        
        // Sample resource field value using HSV hue matching
        float sampleResource(vec2 wldPos, vec3 pref) {
            vec2 resUV = (wldPos / dishR) * 0.5 + 0.5;
            vec4 res = texture(resourceTex, resUV);
            
            // Convert both colors to HSV
            vec3 prefHSV = rgb2hsv(pref);
            vec3 resHSV = rgb2hsv(res.rgb);
            
            float myHue = prefHSV.x;
            float resHue = resHSV.x;
            float resSat = resHSV.y;  // Use saturation to ignore gray pixels
            
            // Calculate angular hue distance (0-0.5 range due to wraparound)
            float hueDiff = hueDistance(myHue, resHue);
            float threshold = hueThreshold / 360.0;  // Convert degrees to 0-1 range
            
            // Attraction falls off linearly as hue difference approaches threshold
            // Multiply by saturation so gray pixels don't attract
            float attraction = hueDiff < threshold 
                ? (1.0 - hueDiff / threshold) * resSat 
                : 0.0;
            
            return attraction * res.a;
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
            
            // Read life cycle state: state1 = (rep, energy, birthStep, clock)
            float myEnergy = out1.y;
            float birthStep = out1.z;  // Store birth step, calculate age when needed
            
            if (paused) {
                out1 = updateClock(out1);
                return;
            }
            
            // No need to increment age - we calculate it from birthStep when needed
            
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
            // Store: (repulsion, energy, birthStep, clock)
            // birthStep stays constant - age calculated as currentStep - birthStep when needed
            out1 = vec4(rep, myEnergy, birthStep, clock);
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
        
        // Store original image dimensions before resizing
        this.originalWidth = img.naturalWidth || img.width || 512;
        this.originalHeight = img.naturalHeight || img.height || 512;
        this.originalAspectRatio = this.originalWidth / this.originalHeight;
        
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
        
        // Reset compressed reconstruction cache when new image is loaded
        this.compressedReconstruction = null;
        this.eatenPixelsCache = null;
        this.lastEatenCount = 0;
        this.lastReconstructionDims = null;  // Reset dimensions for new image
        
        // Delete old reconstruction texture if it exists (will be recreated with new dimensions)
        if (this.compressedReconstructionTex) {
            const gl = this.gl;
            gl.deleteTexture(this.compressedReconstructionTex);
            this.compressedReconstructionTex = null;
        }
        
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

    getEatenPixels(forceRefresh = false) {
        // Return cached result if available and not forcing refresh
        // GPU readbacks are expensive, so cache aggressively
        if (!forceRefresh && this.eatenPixelsCache !== null) {
            return this.eatenPixelsCache;
        }
        
        const gl = this.gl;
        const width = 512;
        const height = 512;
        
        // Read back resource texture (expensive GPU operation)
        const pixels = new Float32Array(width * height * 4);
        twgl.bindFramebufferInfo(gl, this.resourceTex);
        gl.readPixels(0, 0, width, height, gl.RGBA, gl.FLOAT, pixels);
        twgl.bindFramebufferInfo(gl, null);
        
        // Find all pixels with alpha < 0.1 (mostly eaten)
        const eatenPixels = [];
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const idx = (y * width + x) * 4;
                const alpha = pixels[idx + 3];
                if (alpha < 0.1) {  // Use 0.1 threshold as specified
                    eatenPixels.push({
                        x: x,
                        y: y,
                        r: pixels[idx + 0],
                        g: pixels[idx + 1],
                        b: pixels[idx + 2]
                    });
                }
            }
        }
        
        // Cache the result to avoid repeated expensive readbacks
        this.eatenPixelsCache = eatenPixels;
        
        return eatenPixels;
    }

    computeOptimalDimensions(eatenCount, aspectRatio) {
        if (eatenCount === 0) {
            return { width: 0, height: 0, pixelCount: 0 };
        }
        
        // Find the largest valid dimensions that fit within eatenCount
        // Try increasing widths until we find the maximum that fits
        let bestWidth = 1;
        let bestHeight = 1;
        let bestPixelCount = 1;
        
        // Start from small and work up to find maximum valid size
        for (let w = 1; w <= Math.ceil(Math.sqrt(eatenCount * aspectRatio)); w++) {
            const h = Math.floor(w / aspectRatio);
            if (h < 1) continue;
            const pixelCount = w * h;
            if (pixelCount <= eatenCount && pixelCount > bestPixelCount) {
                bestWidth = w;
                bestHeight = h;
                bestPixelCount = pixelCount;
            }
        }
        
        return {
            width: bestWidth,
            height: bestHeight,
            pixelCount: bestPixelCount
        };
    }

    createCompressedReconstruction(forceUpdate = false) {
        if (!this.originalResourceData || !this.originalAspectRatio) {
            return null;
        }
        
        // Performance timing (optional, can be removed after optimization)
        const perfStart = performance.now();
        
        // Only refresh eaten pixels if cache is invalid or forced
        // This avoids expensive GPU readbacks
        const eatenPixels = this.getEatenPixels(forceUpdate);
        const eatenCount = eatenPixels.length;
        const perfAfterRead = performance.now();
        
        if (eatenCount === 0) {
            this.compressedReconstruction = null;
            return null;
        }
        
        // Compute optimal dimensions
        const dims = this.computeOptimalDimensions(eatenCount, this.originalAspectRatio);
        
        if (dims.pixelCount === 0) {
            this.compressedReconstruction = null;
            return null;
        }
        
        // Only recompute when the achievable image size (pixelCount) grows.
        const prevPixelCount = this.lastReconstructionDims
            ? this.lastReconstructionDims.width * this.lastReconstructionDims.height
            : 0;
        const needsUpdate = !this.compressedReconstruction ||
                            dims.pixelCount > prevPixelCount ||
                            forceUpdate;
        
        if (!needsUpdate && this.compressedReconstruction) {
            return this.compressedReconstruction;
        }
        
        // Rescale original image to target compressed size
        const canvas = document.createElement('canvas');
        canvas.width = 512;
        canvas.height = 512;
        const ctx = canvas.getContext('2d');
        const imageData = ctx.createImageData(512, 512);
        
        // Reconstruct original image data from float array
        for (let i = 0; i < this.originalResourceData.length; i += 4) {
            const idx = i / 4;
            const x = idx % 512;
            const y = Math.floor(idx / 512);
            const pixelIdx = (y * 512 + x) * 4;
            imageData.data[pixelIdx + 0] = Math.round(this.originalResourceData[i + 0] * 255);
            imageData.data[pixelIdx + 1] = Math.round(this.originalResourceData[i + 1] * 255);
            imageData.data[pixelIdx + 2] = Math.round(this.originalResourceData[i + 2] * 255);
            imageData.data[pixelIdx + 3] = 255;
        }
        ctx.putImageData(imageData, 0, 0);
        
        // Create target canvas for compressed size
        const targetCanvas = document.createElement('canvas');
        targetCanvas.width = dims.width;
        targetCanvas.height = dims.height;
        const targetCtx = targetCanvas.getContext('2d');
        
        // Draw original rescaled to target size
        targetCtx.drawImage(canvas, 0, 0, dims.width, dims.height);
        const targetImageData = targetCtx.getImageData(0, 0, dims.width, dims.height);
        
        // Safety check: if computation would be too expensive, use simpler algorithm
        const totalTargets = dims.width * dims.height;
        const maxOperations = 50 * 1000 * 1000;  // 50M operations max to avoid freeze
        const estimatedOps = totalTargets * eatenPixels.length;
        
        // Optimized greedy pixel placement: use spatial sampling to avoid O(n*m) complexity
        // For large sets, limit search to a random sample of eaten pixels per target
        const resultImageData = targetCtx.createImageData(dims.width, dims.height);
        const usedPixels = new Set();
        
        // Calculate max samples per target to keep under operation limit
        let maxSearchPerTarget;
        if (estimatedOps > maxOperations) {
            // Limit search to keep total operations reasonable
            maxSearchPerTarget = Math.max(10, Math.floor(maxOperations / totalTargets));
        } else {
            // Use reasonable sample size (10% of eaten pixels, min 100, max all)
            maxSearchPerTarget = Math.min(eatenPixels.length, Math.max(100, Math.floor(eatenPixels.length / 10)));
        }
        
        // Pre-shuffle eaten pixels for random sampling
        const shuffledIndices = Array.from({length: eatenPixels.length}, (_, i) => i);
        for (let i = shuffledIndices.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [shuffledIndices[i], shuffledIndices[j]] = [shuffledIndices[j], shuffledIndices[i]];
        }
        
        // For each target position, find best matching eaten pixel from sample
        for (let ty = 0; ty < dims.height; ty++) {
            for (let tx = 0; tx < dims.width; tx++) {
                const targetIdx = (ty * dims.width + tx) * 4;
                const tr = targetImageData.data[targetIdx + 0] / 255.0;
                const tg = targetImageData.data[targetIdx + 1] / 255.0;
                const tb = targetImageData.data[targetIdx + 2] / 255.0;
                
                // Find unused eaten pixel with minimum chi-square distance
                // Limit search to maxSearchPerTarget random samples to avoid O(n*m)
                let bestPixel = null;
                let bestDistance = Infinity;
                let bestIndex = -1;
                let samplesChecked = 0;
                
                for (let si = 0; si < shuffledIndices.length && samplesChecked < maxSearchPerTarget; si++) {
                    const i = shuffledIndices[si];
                    if (usedPixels.has(i)) continue;
                    samplesChecked++;
                    
                    const pixel = eatenPixels[i];
                    const dr = pixel.r - tr;
                    const dg = pixel.g - tg;
                    const db = pixel.b - tb;
                    const distance = dr * dr + dg * dg + db * db;
                    
                    if (distance < bestDistance) {
                        bestDistance = distance;
                        bestPixel = pixel;
                        bestIndex = i;
                    }
                }
                
                // Assign best pixel to this position
                if (bestPixel && bestIndex >= 0) {
                    resultImageData.data[targetIdx + 0] = Math.round(bestPixel.r * 255);
                    resultImageData.data[targetIdx + 1] = Math.round(bestPixel.g * 255);
                    resultImageData.data[targetIdx + 2] = Math.round(bestPixel.b * 255);
                    resultImageData.data[targetIdx + 3] = 255;
                    usedPixels.add(bestIndex);
                } else {
                    // Fallback: use target color if no pixel available
                    resultImageData.data[targetIdx + 0] = targetImageData.data[targetIdx + 0];
                    resultImageData.data[targetIdx + 1] = targetImageData.data[targetIdx + 1];
                    resultImageData.data[targetIdx + 2] = targetImageData.data[targetIdx + 2];
                    resultImageData.data[targetIdx + 3] = 255;
                }
            }
        }
        
        targetCtx.putImageData(resultImageData, 0, 0);
        
        // Upload to WebGL texture - reuse texture object if dimensions match
        const gl = this.gl;
        if (!this.compressedReconstructionTex || 
            this.compressedReconstructionTex.width !== dims.width ||
            this.compressedReconstructionTex.height !== dims.height) {
            // Create or recreate texture only if dimensions changed
            if (this.compressedReconstructionTex) {
                gl.deleteTexture(this.compressedReconstructionTex);
            }
            this.compressedReconstructionTex = gl.createTexture();
            gl.bindTexture(gl.TEXTURE_2D, this.compressedReconstructionTex);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);  // Pixel art - no resampling
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);  // Pixel art - no resampling
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        }
        
        // Update texture data (reuse existing texture object)
        gl.bindTexture(gl.TEXTURE_2D, this.compressedReconstructionTex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, targetCanvas);
        gl.bindTexture(gl.TEXTURE_2D, null);
        
        // Store dimensions on texture for reference
        this.compressedReconstructionTex.width = dims.width;
        this.compressedReconstructionTex.height = dims.height;
        
        // Cache the result
        this.compressedReconstruction = {
            texture: this.compressedReconstructionTex,
            width: dims.width,
            height: dims.height
        };
        this.lastEatenCount = eatenCount;
        this.lastReconstructionDims = dims;
        
        // Performance timing (optional, can be removed after optimization)
        const perfEnd = performance.now();
        if (perfEnd - perfStart > 16) {  // Only log if > 16ms (one frame at 60fps)
            console.log(`[PERF] Reconstruction: ${(perfEnd - perfStart).toFixed(2)}ms (read: ${(perfAfterRead - perfStart).toFixed(2)}ms, compute: ${(perfEnd - perfAfterRead).toFixed(2)}ms)`);
        }
        
        return this.compressedReconstruction;
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
                float birthStep = s1.z;
                float age = currentStep - birthStep;  // Calculate age from birthStep
                
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
            
            // Check if ready to reproduce (energy >= threshold AND age >= minimum)
            float birthStep = out1.z;
            float age = currentStep - birthStep;  // Calculate age from birthStep
            float energy = out1.y;
            // Enforce minimum age requirement - particles must be old enough
            if (energy >= reproThreshold && age >= reproMinAge) {
                // Mark for reproduction by setting high w value (temporary flag)
                // and deduct energy cost
                out1 = vec4(out1.x, energy - reproCost, birthStep, 999.0);
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
                // Store currentStep as birthStep - age calculated as currentStep - birthStep
                out1 = vec4(0.5, reproCost * 0.5, currentStep, 0.0);  // (rep, energy, birthStep, clock)
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
            
            // If this is a new particle (birthStep == currentStep, meaning just born), give it mutated preferences
            float birthStep = s1.z;
            float age = currentStep - birthStep;
            if (isAlive(p) && age < 1.0 && s1.y > 0.0) {
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
            // Dark blue/purple background for better particle color contrast
            vec3 colorUG = mix(vec3(0.05, 0.05, 0.12), vec3(0.15, 0.2, 0.35), c);
            // Connection glow: subtle white instead of yellow, lets particle colors show
            colorUG = mix(colorUG, vec3(0.4, 0.45, 0.5), G_dG.x*min(c*2.0, 1.0) * 0.6);
            vec3 bg = vec3(0.08, 0.08, 0.15);  // Dark background
            vec3 color = fieldGE>0.0? mix(bg, colorE, fieldGE) : mix(bg, colorUG, -fieldGE);

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
            
            // Solid core (inner 60% is fully opaque)
            float core = smoothstep(1.0, 0.6, r);
            // Subtle outer glow
            float glow = max(0.0, 1.0 - r) * 0.25;
            float a = max(core, glow);
            
            // Slight 3D shading on the core
            vec3 n = normalize(vec3(uv * 0.5, 1.0));
            float v = max(dot(n, getLightDir(wldPos)), 0.0) * 0.4 + 0.6;
            
            // Brighter, more saturated color for visibility
            vec3 brightColor = color * 1.2;
            out0 = vec4(brightColor * v * a, a) * pointsAlpha;
        }`, {dst:target, n:this.max_point_n, blend:[gl.ONE, gl.ONE_MINUS_SRC_ALPHA]}, {flipUD});
    }

    // ========== TRAIL VISUALIZATION METHODS ==========
    
    accumulateTrails() {
        const gl = this.gl;
        // Render each particle as a small colored dot into trailTex
        // Using additive blending so trails build up over time
        this.runProgram(`
        out vec3 color;
        void main() {
            uv = quad * 0.5;  // Small dot size
            Particle p = getParticle();
            if (!p.visible) { 
                gl_Position = vec4(0.0); 
                return; 
            }
            // Map world position to trail texture clip space
            vec2 texPos = (p.pos / dishR) * 0.5 + 0.5;
            vec2 clipPos = texPos * 2.0 - 1.0;
            float dotSize = 0.008;  // Size of trail dot
            gl_Position = vec4(clipPos + uv * dotSize, 0.0, 1.0);
            color = p.color;
        }
        //FRAG
        in vec3 color;
        void main() {
            float r = length(uv);
            float a = smoothstep(1.0, 0.0, r) * 0.05;  // Subtle paint accumulation
            out0 = vec4(color * a, a);
        }`, {n: this.max_point_n, dst: this.trailTex, blend: [gl.ONE, gl.ONE]});
    }
    
    clearTrails() {
        // Clear trail texture to black
        this.runProgram(`
        void main() { 
            out0 = vec4(0.0, 0.0, 0.0, 0.0); 
        }`, {dst: this.trailTex, clear: true});
    }
    
    renderCompressedReconstruction(target, {viewCenter=[0,0], viewExtent=50.0}={}) {
        // Only update reconstruction periodically, not every frame (too expensive!)
        // Update every 180 frames (3 seconds at 60fps) to reduce GPU readback frequency
        const updateInterval = 180;
        this.reconstructionUpdateFrame = (this.reconstructionUpdateFrame || 0) + 1;
        const currentFrame = this.reconstructionUpdateFrame;
        const shouldUpdate = !this.compressedReconstruction || 
                            (currentFrame % updateInterval === 0);
        
        if (shouldUpdate) {
            // Force refresh of eaten pixels to get latest data, but don't force full reconstruction
            // (createCompressedReconstruction will still use its own logic to decide if reconstruction needs update)
            this.eatenPixelsCache = null;  // Clear cache to force fresh read
            const reconstruction = this.createCompressedReconstruction(false);
            if (!reconstruction || !reconstruction.texture) {
                // No reconstruction available - render black screen
                const gl = this.gl;
                const {width, height} = target || gl.canvas;
                gl.viewport(0, 0, width, height);
                gl.clearColor(0.0, 0.0, 0.0, 1.0);
                gl.clear(gl.COLOR_BUFFER_BIT);
                return;
            }
        }
        
        const reconstruction = this.compressedReconstruction;
        if (!reconstruction || !reconstruction.texture) {
            const gl = this.gl;
            const {width, height} = target || gl.canvas;
            gl.viewport(0, 0, width, height);
            gl.clearColor(0.0, 0.0, 0.0, 1.0);
            gl.clear(gl.COLOR_BUFFER_BIT);
            return;
        }
        
        // Render using the same approach as renderTrails - simple and direct
        const {width, height} = target || gl.canvas;
        const viewAspect = width / Math.max(1.0, height);
        Object.assign(this.U, {viewCenter, viewExtent, viewAspect});
        
        const imgWidth = reconstruction.width;
        const imgHeight = reconstruction.height;
        
        // Render texture directly to screen with view transform (like trails mode)
        this.runProgram(`
        uniform sampler2D compressedTex;
        uniform vec2 imgSize;
        void main() {
            // Convert screen UV to world position
            vec2 wldPos = scr2wld(uv * 2.0 - 1.0);
            
            // Image is centered at origin, spans from -imgSize/2 to +imgSize/2
            // Convert world position to texture UV (0 to 1)
            vec2 imgUV = (wldPos + imgSize * 0.5) / imgSize;
            
            // Clamp to valid UV range
            imgUV = clamp(imgUV, 0.0, 1.0);
            
            // Sample the compressed reconstruction texture
            vec4 color = texture(compressedTex, imgUV);
            
            // Dark background
            vec3 bg = vec3(0.0, 0.0, 0.0);
            out0 = vec4(bg + color.rgb, 1.0);
        }`, {dst: target || null}, {compressedTex: reconstruction.texture, imgSize: [imgWidth, imgHeight]});
    }

    renderTrails(target, {viewCenter=[0,0], viewExtent=50.0, flipUD=false}={}) {
        const {width, height} = target || this.gl.canvas;
        const viewAspect = width / Math.max(1.0, height);
        Object.assign(this.U, {viewCenter, viewExtent, viewAspect});
        
        // Render trail texture to screen with view transform
        this.runProgram(`
        uniform bool flipUD;
        void main() {
            vec2 p = flipUD ? vec2(uv.x, 1.0-uv.y) : uv;
            vec2 wldPos = scr2wld(p * 2.0 - 1.0);
            vec2 trailUV = (wldPos / dishR) * 0.5 + 0.5;
            
            // Sample trail texture
            vec4 trail = texture(trailTex, trailUV);
            
            // Dark background with trail colors
            vec3 bg = vec3(0.02, 0.02, 0.05);
            vec3 color = bg + trail.rgb;
            
            // Boundary indicator
            float d = length(wldPos) / dishR;
            if (d > 1.0) color *= 0.3;
            
            out0 = vec4(color, 1.0);
        }`, {dst: target}, {flipUD});
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