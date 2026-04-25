export function collectInspectionInfo(root) {
  const materialSet = new Set();
  let meshes = 0;
  let triangles = 0;

  root?.traverse?.((node) => {
    if (!node?.isMesh) return;
    meshes += 1;

    if (node.geometry?.index?.count) {
      triangles += Math.floor(node.geometry.index.count / 3);
    } else if (node.geometry?.attributes?.position?.count) {
      triangles += Math.floor(node.geometry.attributes.position.count / 3);
    }

    const sourceMaterials = Array.isArray(node.material) ? node.material : [node.material];
    sourceMaterials.filter(Boolean).forEach((material) => materialSet.add(material));
  });

  const materials = [...materialSet].map((material) => ({
    id: material.uuid,
    name: material.name || 'Unnamed',
    type: material.type,
    color: material.color?.getHexString ? `#${material.color.getHexString()}` : '-',
    map: material.map ? 'yes' : 'no'
  }));

  return {
    meshes,
    triangles,
    materials
  };
}

export function applyWireframe(root, enabled) {
  root?.traverse?.((node) => {
    if (!node?.isMesh || !node.material) return;
    const materials = Array.isArray(node.material) ? node.material : [node.material];
    materials.forEach((material) => {
      if (material && 'wireframe' in material) {
        material.wireframe = enabled;
        material.needsUpdate = true;
      }
    });
  });
}
