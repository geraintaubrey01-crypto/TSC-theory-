(() => {
  'use strict';

  const GRID = 256;
  const canvas = document.getElementById('field');
  const status = document.getElementById('status');
  const readout = document.getElementById('readout');
  const topologySelect = document.getElementById('topology');
  const speedInput = document.getElementById('speed');
  const dampingInput = document.getElementById('damping');
  const impulseInput = document.getElementById('impulse');
  const gl = canvas.getContext('webgl2', { alpha: false, antialias: false });

  if (!gl) {
    showError('WebGL2 is unavailable. Try a current browser with hardware acceleration enabled.');
    return;
  }
  if (!gl.getExtension('EXT_color_buffer_float')) {
    showError('This browser does not support floating-point WebGL render targets required by the solver.');
    return;
  }

  const vertexSource = `#version 300 es
    precision highp float;
    const vec2 POSITIONS[3] = vec2[3](
      vec2(-1.0, -1.0), vec2(3.0, -1.0), vec2(-1.0, 3.0)
    );
    out vec2 uv;
    void main() {
      vec2 p = POSITIONS[gl_VertexID];
      uv = p * 0.5 + 0.5;
      gl_Position = vec4(p, 0.0, 1.0);
    }`;

  const stepSource = `#version 300 es
    precision highp float;
    precision highp int;
    uniform sampler2D state;
    uniform int topology;
    uniform float speed;
    uniform float damping;
    uniform vec2 impulsePoint;
    uniform float impulseAmount;
    uniform float impulseRadius;
    out vec4 nextState;

    ivec2 mapCell(ivec2 p, out bool valid) {
      int n = textureSize(state, 0).x;
      valid = true;
      if (p.x < 0 || p.x >= n) {
        if (topology == 0) { valid = false; return p; }
        p.x = (p.x + n) % n;
        if (topology == 2 || topology == 3) p.y = n - 1 - p.y;
      }
      if (p.y < 0 || p.y >= n) {
        if (topology == 1 || topology == 3) p.y = (p.y + n) % n;
        else { valid = false; return p; }
      }
      return p;
    }

    float sampleField(ivec2 p) {
      bool valid;
      ivec2 mapped = mapCell(p, valid);
      if (!valid) return 0.0;
      return texelFetch(state, mapped, 0).r;
    }

    void main() {
      ivec2 p = ivec2(gl_FragCoord.xy);
      vec4 old = texelFetch(state, p, 0);
      float current = old.r;
      int n = textureSize(state, 0).x;
      bool openY = topology == 0 || topology == 2;
      if ((topology == 0 && (p.x == 0 || p.x == n - 1)) ||
          (openY && (p.y == 0 || p.y == n - 1))) {
        nextState = vec4(0.0);
        return;
      }
      float previous = old.g;
      float laplacian =
        sampleField(p + ivec2(1, 0)) + sampleField(p + ivec2(-1, 0)) +
        sampleField(p + ivec2(0, 1)) + sampleField(p + ivec2(0, -1)) -
        4.0 * current;
      float next = 2.0 * current - previous + speed * speed * laplacian
        - damping * (current - previous);
      vec2 cellUv = (vec2(p) + 0.5) / float(textureSize(state, 0).x);
      float radius = max(impulseRadius, 0.001);
      float r2 = dot((cellUv - impulsePoint) / radius, (cellUv - impulsePoint) / radius);
      next += impulseAmount * exp(-4.0 * r2);
      nextState = vec4(next, current, 0.0, 1.0);
    }`;

  const displaySource = `#version 300 es
    precision highp float;
    uniform sampler2D state;
    in vec2 uv;
    out vec4 color;
    void main() {
      float value = texture(state, uv).r;
      float intensity = clamp(abs(value) * 1.15, 0.0, 1.0);
      vec3 base = value >= 0.0 ? vec3(0.10, 0.78, 0.93) : vec3(1.0, 0.43, 0.20);
      vec3 background = vec3(0.025, 0.055, 0.09);
      color = vec4(mix(background, base, intensity), 1.0);
    }`;

  const stepProgram = makeProgram(vertexSource, stepSource);
  const displayProgram = makeProgram(vertexSource, displaySource);
  if (!stepProgram || !displayProgram) return;
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);

  const targets = [makeTarget(), makeTarget()];
  if (targets.some(target => !target)) {
    showError('Could not create floating-point simulation buffers.');
    return;
  }
  targets.forEach(target => {
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
    gl.viewport(0, 0, GRID, GRID);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
  });
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);

  const stepLocations = locations(stepProgram, ['state', 'topology', 'speed', 'damping', 'impulsePoint', 'impulseAmount', 'impulseRadius']);
  const displayLocations = locations(displayProgram, ['state']);
  let readIndex = 0;
  let paused = false;
  let stepCount = 0;
  let pendingImpulse = null;
  let dragging = false;

  function makeProgram(vertex, fragment) {
    const vs = compile(gl.VERTEX_SHADER, vertex);
    const fs = compile(gl.FRAGMENT_SHADER, fragment);
    if (!vs || !fs) return null;
    const program = gl.createProgram();
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      showError(`Shader link failed: ${gl.getProgramInfoLog(program)}`);
      return null;
    }
    return program;
  }

  function compile(type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      showError(`Shader compilation failed: ${gl.getShaderInfoLog(shader)}`);
      gl.deleteShader(shader);
      return null;
    }
    return shader;
  }

  function makeTarget() {
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, GRID, GRID, 0, gl.RGBA, gl.HALF_FLOAT, null);
    const framebuffer = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) return null;
    return { texture, framebuffer };
  }

  function locations(program, names) {
    return Object.fromEntries(names.map(name => [name, gl.getUniformLocation(program, name)]));
  }

  function topologyCode() {
    return { plane: 0, torus: 1, mobius: 2, klein: 3 }[topologySelect.value];
  }

  function simulate() {
    const writeIndex = 1 - readIndex;
    const impulse = pendingImpulse;
    gl.bindFramebuffer(gl.FRAMEBUFFER, targets[writeIndex].framebuffer);
    gl.viewport(0, 0, GRID, GRID);
    gl.useProgram(stepProgram);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, targets[readIndex].texture);
    gl.uniform1i(stepLocations.state, 0);
    gl.uniform1i(stepLocations.topology, topologyCode());
    gl.uniform1f(stepLocations.speed, Number(speedInput.value));
    gl.uniform1f(stepLocations.damping, Number(dampingInput.value));
    gl.uniform2f(stepLocations.impulsePoint, impulse ? impulse.x : -10, impulse ? impulse.y : -10);
    gl.uniform1f(stepLocations.impulseAmount, impulse ? Number(impulseInput.value) : 0);
    gl.uniform1f(stepLocations.impulseRadius, 0.025);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    readIndex = writeIndex;
    if (impulse) pendingImpulse = null;
    stepCount++;
  }

  function draw() {
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.round(canvas.clientWidth * pixelRatio));
    const height = Math.max(1, Math.round(canvas.clientHeight * pixelRatio));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, width, height);
    gl.useProgram(displayProgram);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, targets[readIndex].texture);
    gl.uniform1i(displayLocations.state, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    readout.textContent = `${stepCount.toLocaleString()} simulated steps · ${GRID} × ${GRID}`;
  }

  function frame() {
    if (!paused) simulate();
    draw();
    requestAnimationFrame(frame);
  }

  function addImpulse(event) {
    const rect = canvas.getBoundingClientRect();
    pendingImpulse = {
      x: (event.clientX - rect.left) / rect.width,
      y: 1 - (event.clientY - rect.top) / rect.height
    };
  }

  canvas.addEventListener('pointerdown', event => {
    dragging = true;
    canvas.setPointerCapture(event.pointerId);
    addImpulse(event);
  });
  canvas.addEventListener('pointermove', event => {
    if (dragging) addImpulse(event);
  });
  canvas.addEventListener('pointerup', () => { dragging = false; });
  canvas.addEventListener('pointercancel', () => { dragging = false; });
  document.getElementById('pause').addEventListener('click', event => {
    paused = !paused;
    event.currentTarget.textContent = paused ? 'Resume' : 'Pause';
    status.textContent = paused ? 'Paused' : 'Running · WebGL2';
  });
  document.getElementById('reset').addEventListener('click', () => {
    targets.forEach(target => {
      gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
      gl.viewport(0, 0, GRID, GRID);
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
    });
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    readIndex = 0;
    stepCount = 0;
    pendingImpulse = null;
  });
  for (const [input, output] of [
    [speedInput, 'speedValue'],
    [dampingInput, 'dampingValue'],
    [impulseInput, 'impulseValue']
  ]) {
    input.addEventListener('input', () => {
      const precision = input.step.split('.')[1]?.length ?? 0;
      document.getElementById(output).value = Number(input.value).toFixed(precision);
    });
  }

  status.textContent = 'Running · WebGL2';
  requestAnimationFrame(frame);

  function showError(message) {
    status.textContent = 'Unavailable';
    status.classList.add('error');
    canvas.replaceWith(Object.assign(document.createElement('p'), {
      className: 'error-message',
      textContent: message
    }));
  }
})();
