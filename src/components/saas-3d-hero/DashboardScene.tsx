import { Suspense, useLayoutEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { ContactShadows, Environment, Html } from "@react-three/drei";
import { RoundedBox } from "@react-three/drei/core/RoundedBox.js";
import type { Group } from "three";
import { DashboardUiLayer } from "./DashboardUiLayer";
import { FloatingDepthCards } from "./FloatingDepthCards";
import { MiniChartBars } from "./MiniChartBars";
import { GroundReflection } from "./GroundReflection";
import { DashboardPostEffects } from "./DashboardPostEffects";

type SceneProps = {
  reducedMotion: boolean;
  /** 256 tablet / mobile, 512 desktop */
  reflectorResolution: number;
};

export function DashboardScene({ reducedMotion, reflectorResolution }: SceneProps) {
  const rig = useRef<Group>(null);
  const panel = useRef<Group>(null);
  const { pointer, viewport } = useThree();

  useLayoutEffect(() => {
    if (!reducedMotion) return;
    const r = rig.current;
    const p = panel.current;
    if (!r || !p) return;
    r.rotation.set(-0.12, 0.32, 0);
    p.position.y = 0;
  }, [reducedMotion]);

  useFrame(({ clock }) => {
    if (reducedMotion) return;

    const r = rig.current;
    const p = panel.current;
    if (!r || !p) return;

    const t = clock.elapsedTime;
    const parallaxX = pointer.x * 0.14;
    const parallaxY = pointer.y * 0.08;

    const orbit = Math.sin(t * 0.11) * 0.06;
    const breathe = Math.sin(t * 0.65) * 0.038;
    r.rotation.y = 0.38 + orbit + parallaxX;
    r.rotation.x = -0.14 + Math.sin(t * 0.09) * 0.025 + parallaxY;
    r.rotation.z = Math.sin(t * 0.07) * 0.012;
    p.position.y = breathe;
  });

  const aspect = viewport.aspect;
  const htmlScale = aspect < 1 ? 0.85 : 1;

  return (
    <>
      <fog attach="fog" args={["#0a1028", 7, 22]} />

      <ambientLight intensity={0.28} color="#b8c5ff" />
      <directionalLight
        castShadow
        position={[4.5, 8, 4]}
        intensity={1.35}
        color="#e8ecff"
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
        shadow-camera-far={30}
        shadow-camera-near={1}
        shadow-camera-left={-8}
        shadow-camera-right={8}
        shadow-camera-top={8}
        shadow-camera-bottom={-8}
      />
      <directionalLight position={[-5, 2, -2]} intensity={0.35} color="#7c3aed" />
      <pointLight position={[2, -1, 3]} intensity={0.55} color="#6366f1" distance={12} decay={2} />

      <Suspense fallback={null}>
        <Environment preset="city" />
      </Suspense>

      <group ref={rig} position={[0, 0.05, 0]}>
        <group ref={panel} rotation={[-0.2, 0.22, 0.02]} position={[0, 0, 0]}>
          <FloatingDepthCards animated={!reducedMotion} />

          <RoundedBox
            args={[2.85, 1.72, 0.14]}
            position={[0.06, 0, -0.12]}
            radius={0.1}
            smoothness={4}
            receiveShadow
          >
            <meshPhysicalMaterial
              color="#0f172a"
              roughness={0.55}
              metalness={0.35}
              clearcoat={0.5}
              clearcoatRoughness={0.35}
            />
          </RoundedBox>

          <RoundedBox args={[2.78, 1.65, 0.055]} radius={0.1} smoothness={4} castShadow receiveShadow>
            <meshPhysicalMaterial
              color="#1e293b"
              roughness={0.2}
              metalness={0.15}
              transmission={0.65}
              thickness={0.45}
              ior={1.45}
              transparent
              opacity={0.88}
              attenuationColor="#312e81"
              attenuationDistance={0.85}
              clearcoat={1}
              clearcoatRoughness={0.12}
              emissive="#1e1b4b"
              emissiveIntensity={0.08}
            />
          </RoundedBox>

          <Html
            transform
            occlude={false}
            position={[0, 0, 0.05]}
            distanceFactor={5.2 * htmlScale}
            style={{ transformOrigin: "center center" }}
          >
            <DashboardUiLayer animated={!reducedMotion} />
          </Html>

          <group position={[1.05, -0.35, 0.18]} rotation={[0, -0.35, 0.08]}>
            <MiniChartBars animated={!reducedMotion} />
          </group>
        </group>

        <ContactShadows
          position={[0, -1.32, 0.5]}
          opacity={0.55}
          scale={12}
          blur={2.8}
          far={4.5}
          color="#000000"
        />

        <GroundReflection resolution={reflectorResolution} />
      </group>

      <DashboardPostEffects reducedMotion={reducedMotion} />
    </>
  );
}
