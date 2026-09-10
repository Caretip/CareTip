import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { RoundedBox } from "@react-three/drei/core/RoundedBox.js";
import type { Group } from "three";

type CardProps = {
  position: [number, number, number];
  size: [number, number, number];
  color: string;
  emissive: string;
  phase: number;
  animated: boolean;
};

function DepthCard({ position, size, color, emissive, phase, animated }: CardProps) {
  const ref = useRef<Group>(null);
  useFrame(({ clock }) => {
    if (!animated) return;
    const g = ref.current;
    if (!g) return;
    const t = clock.elapsedTime;
    g.position.y = position[1] + Math.sin(t * 0.9 + phase) * 0.035;
    g.rotation.z = Math.sin(t * 0.35 + phase) * 0.02;
  });
  return (
    <group ref={ref} position={position}>
      <RoundedBox args={size} radius={0.06} smoothness={3} castShadow receiveShadow>
        <meshPhysicalMaterial
          color={color}
          emissive={emissive}
          emissiveIntensity={0.35}
          roughness={0.35}
          metalness={0.25}
          transparent
          opacity={0.92}
          transmission={0.12}
          thickness={0.3}
          clearcoat={0.85}
          clearcoatRoughness={0.2}
        />
      </RoundedBox>
    </group>
  );
}

type FloatingDepthCardsProps = {
  /** When false, cards stay fixed (no per-frame motion). */
  animated?: boolean;
};

/** Smaller glass slabs behind / beside the main panel for parallax depth. */
export function FloatingDepthCards({ animated = true }: FloatingDepthCardsProps) {
  return (
    <group>
      <DepthCard
        position={[-1.35, 0.22, -0.28]}
        size={[0.55, 0.38, 0.04]}
        color="#1e1b4b"
        emissive="#4c1d95"
        phase={0}
        animated={animated}
      />
      <DepthCard
        position={[1.28, -0.18, -0.18]}
        size={[0.48, 0.32, 0.035]}
        color="#0f172a"
        emissive="#312e81"
        phase={1.2}
        animated={animated}
      />
      <DepthCard
        position={[0.85, 0.55, -0.35]}
        size={[0.4, 0.22, 0.03]}
        color="#172554"
        emissive="#5b21b6"
        phase={2.1}
        animated={animated}
      />
    </group>
  );
}
