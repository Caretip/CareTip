import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { RoundedBox } from "@react-three/drei/core/RoundedBox.js";
import type { Group } from "three";
import { HERO_CHART_POINTS } from "./dummyData";

const MAX = Math.max(...HERO_CHART_POINTS.map((p) => p.v));

type MiniChartBarsProps = {
  animated?: boolean;
};

export function MiniChartBars({ animated = true }: MiniChartBarsProps) {
  const group = useRef<Group>(null);
  const heights = useMemo(
    () => HERO_CHART_POINTS.map((p) => 0.15 + (p.v / MAX) * 0.55),
    [],
  );

  useFrame(({ clock }) => {
    if (!animated) return;
    const g = group.current;
    if (!g) return;
    const t = clock.elapsedTime;
    g.rotation.y = Math.sin(t * 0.35) * 0.1;
    g.position.z = 0.12 + Math.sin(t * 0.55) * 0.02;
    const pulse = 0.38 + Math.sin(t * 1.6) * 0.12;
    g.children.forEach((child, i) => {
      const mesh = child as { material?: { emissiveIntensity?: number } };
      if (mesh.material && typeof mesh.material.emissiveIntensity === "number") {
        mesh.material.emissiveIntensity = pulse + i * 0.05;
      }
    });
  });

  const gap = 0.16;
  const startX = -((HERO_CHART_POINTS.length - 1) * gap) / 2;

  return (
    <group ref={group} position={[0, -0.52, 0.12]}>
      {HERO_CHART_POINTS.map((_, i) => (
        <RoundedBox
          key={HERO_CHART_POINTS[i]!.m}
          args={[0.09, heights[i]!, 0.06]}
          position={[startX + i * gap, heights[i]! / 2 - 0.05, 0]}
          radius={0.02}
          smoothness={2}
          castShadow
        >
          <meshStandardMaterial
            color="#6366f1"
            emissive="#8b5cf6"
            emissiveIntensity={0.45 + i * 0.04}
            roughness={0.25}
            metalness={0.4}
          />
        </RoundedBox>
      ))}
    </group>
  );
}
