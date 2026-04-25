<script>
  import { onMount, onDestroy } from 'svelte';
  import * as THREE from 'three';
  import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
  import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
  import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
  import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
  import { Box, Loader2, AlertCircle, Maximize2, RotateCcw, Play, Pause, Camera, Grid3X3, ScanEye, Info } from 'lucide-svelte';
  import { buildAuthHeaders, buildModelFileUrl, getModelExtension } from '../services/modelFile.js';
  import { applyWireframe, collectInspectionInfo } from '../services/modelInspection.js';

  let { data } = $props();
  let container = $state(null);
  let canvas = $state(null);
  let loading = $state(true);
  let error = $state(null);
  let statusMessage = $state('Initializing Scene...');
  let hasAnimations = $state(false);
  let isPlaying = $state(true);
  let wireframeEnabled = $state(false);
  let axesEnabled = $state(true);
  let showInspector = $state(true);
  let meshCount = $state(0);
  let triangleCount = $state(0);
  let materialRows = $state([]);
  let sceneAxes = $state(null);
  let lastLoadedPath = $state('');

  let scene, camera, renderer, controls, model, mixer;
  let clock = new THREE.Clock();
  let frameId;

  function initScene() {
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0a0a0a);

    const width = container.clientWidth;
    const height = container.clientHeight;

    camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 1000);
    camera.position.set(5, 5, 5);

    renderer = new THREE.WebGLRenderer({ 
      canvas, 
      antialias: true, 
      alpha: true 
    });
    renderer.setSize(width, height);
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.shadowMap.enabled = true;

    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;

    sceneAxes = new THREE.AxesHelper(2.5);
    sceneAxes.visible = axesEnabled;
    scene.add(sceneAxes);

    // Lights
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambientLight);

    const dirLight = new THREE.DirectionalLight(0xffffff, 1);
    dirLight.position.set(5, 10, 7.5);
    dirLight.castShadow = true;
    scene.add(dirLight);

    const hemiLight = new THREE.HemisphereLight(0xffffff, 0x444444, 0.4);
    hemiLight.position.set(0, 20, 0);
    scene.add(hemiLight);

    animate();
  }

  function animate() {
    frameId = requestAnimationFrame(animate);
    
    const delta = clock.getDelta();
    if (mixer && isPlaying) mixer.update(delta);
    
    if (controls) controls.update();
    if (renderer && scene && camera) {
      renderer.render(scene, camera);
    }
  }

  async function loadModel(path) {
    if (!path) {
      error = "No file path provided";
      loading = false;
      return;
    }

    loading = true;
    error = null;
    statusMessage = "Loading Model...";
    hasAnimations = false;
    materialRows = [];
    meshCount = 0;
    triangleCount = 0;

    const extension = getModelExtension(path);
    let loader;

    const fileUrl = buildModelFileUrl(path);
    const headers = buildAuthHeaders();

    try {
      let loadedObject;
      let animations = [];

      if (extension === 'gltf' || extension === 'glb') {
        loader = new GLTFLoader();
        loader.setRequestHeader(headers);
        const gltf = await new Promise((resolve, reject) => {
          loader.load(fileUrl, resolve, (xhr) => {
            statusMessage = `Downloading: ${Math.round((xhr.loaded / xhr.total) * 100)}%`;
          }, reject);
        });
        loadedObject = gltf.scene;
        animations = gltf.animations;
      } else if (extension === 'fbx') {
        loader = new FBXLoader();
        loader.setRequestHeader(headers);
        loadedObject = await new Promise((resolve, reject) => {
          loader.load(fileUrl, resolve, undefined, reject);
        });
        animations = loadedObject.animations;
      } else if (extension === 'obj') {
        loader = new OBJLoader();
        loader.setRequestHeader(headers);
        loadedObject = await new Promise((resolve, reject) => {
          loader.load(fileUrl, resolve, undefined, reject);
        });
      } else {
        throw new Error(`Unsupported format: ${extension}`);
      }

      if (loadedObject) {
        if (model) {
          scene.remove(model);
        }
        model = loadedObject;
        
        // Setup animations
        if (animations && animations.length > 0) {
          mixer = new THREE.AnimationMixer(model);
          animations.forEach(clip => {
            const action = mixer.clipAction(clip);
            action.play();
          });
          hasAnimations = true;
          isPlaying = true;
        }

        // Center and Frame model
        const box = new THREE.Box3().setFromObject(model);
        const center = box.getCenter(new THREE.Vector3());
        const size = box.getSize(new THREE.Vector3());
        
        // 1. Center the model at (0,0,0) without scaling it
        model.position.x += (model.position.x - center.x);
        model.position.y += (model.position.y - center.y);
        model.position.z += (model.position.z - center.z);
        
        scene.add(model);
        applyWireframe(model, wireframeEnabled);
        const inspection = collectInspectionInfo(model);
        meshCount = inspection.meshes;
        triangleCount = inspection.triangles;
        materialRows = inspection.materials;

        // 2. Calculate optimal camera distance based on FOV and size
        const maxDim = Math.max(size.x, size.y, size.z) || 1;
        const fov = camera.fov * (Math.PI / 180);
        const aspect = camera.aspect;
        
        // Vertical and horizontal distances
        const distY = (size.y / 2) / Math.tan(fov / 2);
        const distX = (size.x / 2) / (Math.tan(fov / 2) * aspect);
        
        // Use the larger distance to ensure fit, with padding
        let distance = Math.max(distY, distX) * 1.5;
        
        // Ensure we don't zoom out too far for tiny models
        distance = Math.max(distance, maxDim * 1.2);

        // 3. Position camera and update controls
        camera.position.set(distance, distance, distance);
        camera.lookAt(0, 0, 0);
        
        // 4. Adjust clipping planes to match model scale
        camera.near = distance / 100;
        camera.far = distance * 10;
        camera.updateProjectionMatrix();

        if (controls) {
          controls.target.set(0, 0, 0);
          controls.maxDistance = distance * 5;
          controls.update();
        }
      }

    } catch (err) {
      error = `Failed to load model: ${err.message}`;
    } finally {
      loading = false;
    }
  }

  function handleResize() {
    if (!container || !renderer || !camera) return;
    const width = container.clientWidth;
    const height = container.clientHeight;
    
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height);
  }

  function toggleWireframe() {
    wireframeEnabled = !wireframeEnabled;
    applyWireframe(model, wireframeEnabled);
  }

  function toggleAxes() {
    axesEnabled = !axesEnabled;
    if (sceneAxes) {
      sceneAxes.visible = axesEnabled;
    }
  }

  function saveScreenshot() {
    if (!renderer || !data?.path) return;
    try {
      renderer.render(scene, camera);
      const image = renderer.domElement.toDataURL('image/png');
      const link = document.createElement('a');
      link.href = image;
      const baseName = data.path.split('/').pop()?.replace(/\.[^.]+$/, '') || 'model';
      link.download = `${baseName}-snapshot.png`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (err) {
      error = `Failed to save screenshot: ${err.message}`;
    }
  }

  onMount(() => {
    initScene();
    if (data?.path) {
      loadModel(data.path);
    }
    window.addEventListener('resize', handleResize);
  });

  onDestroy(() => {
    cancelAnimationFrame(frameId);
    window.removeEventListener('resize', handleResize);
    if (renderer) renderer.dispose();
    if (scene) scene.clear();
    if (mixer) mixer.stopAllAction();
  });

  $effect(() => {
    if (!data?.path || data.path === lastLoadedPath) return;
    lastLoadedPath = data.path;
    loadModel(data.path);
  });
</script>

<div class="model-viewer-app" bind:this={container}>
  <canvas bind:this={canvas}></canvas>

  {#if loading}
    <div class="overlay glass-modal">
      <Loader2 class="spinner" size={48} />
      <span class="status-text">{statusMessage}</span>
    </div>
  {/if}

  {#if error}
    <div class="overlay glass-modal error">
      <AlertCircle size={48} class="error-icon" />
      <span class="error-text">{error}</span>
      <button class="retry-btn" onclick={() => loadModel(data.path)}>Retry</button>
    </div>
  {/if}

  <div class="controls-panel glass-effect">
    <div class="file-info">
      <Box size={16} />
      <span class="filename">{data?.path?.split('/').pop() || 'Untitled 3D Scene'}</span>
    </div>
    <div class="actions">
      {#if hasAnimations}
        <button onclick={() => isPlaying = !isPlaying} title={isPlaying ? "Pause Animation" : "Play Animation"}>
          {#if isPlaying}
            <Pause size={16} />
          {:else}
            <Play size={16} />
          {/if}
        </button>
        <div class="separator"></div>
      {/if}
      <button onclick={toggleWireframe} class:active={wireframeEnabled} title="Wireframe"><Grid3X3 size={16} /></button>
      <button onclick={toggleAxes} class:active={axesEnabled} title="Axes"><ScanEye size={16} /></button>
      <button onclick={() => showInspector = !showInspector} class:active={showInspector} title="Inspector"><Info size={16} /></button>
      <button onclick={saveScreenshot} title="Save Screenshot"><Camera size={16} /></button>
      <button onclick={() => { if (controls) controls.reset(); }} title="Reset View"><RotateCcw size={16} /></button>
      <button onclick={handleResize} title="Fit to Screen"><Maximize2 size={16} /></button>
    </div>
  </div>

  {#if showInspector}
    <aside class="inspector-panel glass-effect">
      <div class="inspector-header">Inspection</div>
      <div class="inspector-grid">
        <div class="metric"><span>Meshes</span><strong>{meshCount}</strong></div>
        <div class="metric"><span>Triangles</span><strong>{triangleCount}</strong></div>
        <div class="metric"><span>Materials</span><strong>{materialRows.length}</strong></div>
      </div>
      <div class="material-list">
        {#if materialRows.length === 0}
          <div class="empty-materials">No material data.</div>
        {:else}
          {#each materialRows as material (material.id)}
            <div class="material-row">
              <div class="name">{material.name}</div>
              <div class="meta">{material.type} · Color {material.color} · Map {material.map}</div>
            </div>
          {/each}
        {/if}
      </div>
    </aside>
  {/if}
</div>

<style>
  .model-viewer-app {
    width: 100%;
    height: 100%;
    position: relative;
    background: #0a0a0a;
    overflow: hidden;
    color: white;
  }

  canvas {
    width: 100% !important;
    height: 100% !important;
    display: block;
  }

  .overlay {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 20px;
    z-index: 10;
    backdrop-filter: blur(10px);
    background: rgba(0, 0, 0, 0.4);
  }

  .glass-modal {
    border: 1px solid rgba(255, 255, 255, 0.1);
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
  }

  .status-text {
    font-size: 14px;
    font-weight: 500;
    letter-spacing: 0.5px;
  }

  .error-text {
    color: #ff5555;
    text-align: center;
    max-width: 300px;
    font-size: 14px;
  }

  .retry-btn {
    padding: 8px 20px;
    background: rgba(255, 255, 255, 0.1);
    border: 1px solid rgba(255, 255, 255, 0.2);
    border-radius: 6px;
    color: white;
    cursor: pointer;
    transition: all 0.2s;
  }

  .retry-btn:hover {
    background: rgba(255, 255, 255, 0.2);
    border-color: rgba(255, 255, 255, 0.4);
  }

  .controls-panel {
    position: absolute;
    bottom: 20px;
    left: 50%;
    transform: translateX(-50%);
    display: flex;
    align-items: center;
    gap: 15px;
    padding: 8px 18px;
    border-radius: 12px;
    z-index: 5;
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.1);
    backdrop-filter: blur(12px);
  }
  .inspector-panel {
    position: absolute;
    top: 14px;
    right: 14px;
    width: min(340px, calc(100% - 28px));
    max-height: calc(100% - 110px);
    overflow: auto;
    padding: 10px;
    border-radius: 12px;
    background: rgba(18, 22, 30, 0.72);
    border: 1px solid rgba(255, 255, 255, 0.12);
    z-index: 6;
  }
  .inspector-header {
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: rgba(255, 255, 255, 0.75);
    margin-bottom: 8px;
  }
  .inspector-grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 6px;
    margin-bottom: 10px;
  }
  .metric {
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 8px;
    padding: 8px;
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 11px;
  }
  .metric strong {
    font-size: 14px;
    color: #d9e8ff;
  }
  .material-list {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .material-row {
    border: 1px solid rgba(255, 255, 255, 0.09);
    border-radius: 8px;
    padding: 8px;
    background: rgba(255, 255, 255, 0.03);
  }
  .material-row .name {
    font-size: 12px;
    font-weight: 600;
    margin-bottom: 2px;
  }
  .material-row .meta {
    font-size: 11px;
    color: rgba(255, 255, 255, 0.74);
  }
  .empty-materials {
    font-size: 12px;
    color: rgba(255, 255, 255, 0.65);
    padding: 8px;
  }

  .file-info {
    display: flex;
    align-items: center;
    gap: 10px;
    border-right: 1px solid rgba(255, 255, 255, 0.1);
    padding-right: 15px;
  }

  .filename {
    font-size: 12px;
    font-weight: 500;
    opacity: 0.9;
  }

  .actions {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .actions button {
    background: transparent;
    border: none;
    color: rgba(255, 255, 255, 0.7);
    cursor: pointer;
    width: 32px;
    height: 32px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 6px;
    transition: all 0.2s;
  }

  .actions button:hover {
    background: rgba(255, 255, 255, 0.1);
    color: white;
  }
  .actions button.active {
    background: rgba(88, 166, 255, 0.2);
    color: #d8ecff;
    border: 1px solid rgba(88, 166, 255, 0.7);
  }

  .separator {
    width: 1px;
    height: 20px;
    background: rgba(255, 255, 255, 0.1);
    margin: 0 4px;
  }

  @keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }
</style>
