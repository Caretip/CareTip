import { MeshReflectorMaterial } from "@react-three/drei/core/MeshReflectorMaterial.js";

type Props = {
  /** Lower resolution on small viewports. */
  resolution: number;
};

export function GroundReflection({ resolution }: Props) {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -1.35, 0.5]} receiveShadow>
      <planeGeometry args={[32, 32]} />
      <MeshReflectorMaterial
        blur={[280, 120]}
        resolution={resolution}
        mixBlur={1}
        mixStrength={0.28}
        roughness={1}
        depthScale={1.15}
        minDepthThreshold={0.35}
        maxDepthThreshold={1.35}
        color="#070b18"
        metalness={0.45}
        mirror={0.42}
      />
    </mesh>
  );
}
