/** Procedural sunset and migration rail; no remote assets, bounded DPR and offscreen rendering. */
"use client";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Float, Stars } from "@react-three/drei";
import { Bloom, EffectComposer } from "@react-three/postprocessing";
import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "framer-motion";
import * as THREE from "three";
type NodeCaption = { left: number; top: number; label: string };
const nodeNames = [
  "Cancel",
  "Decline",
  "Duplicate",
  "Refund",
  "Rounding",
  "Success",
];
function nodePosition(i: number, stacked: boolean): [number, number, number] {
  return stacked
    ? [-6.5 + (i % 6) * 2.6, i < 6 ? 1.45 : -0.95, 0]
    : [-7.45 + i * 1.35, 0.15, 0];
}
function Horizon() {
  const group = useRef<THREE.Group>(null);
  useFrame(({ pointer }) => {
    if (group.current) {
      group.current.rotation.y = THREE.MathUtils.lerp(
        group.current.rotation.y,
        pointer.x * 0.07,
        0.03,
      );
    }
  });
  return (
    <group ref={group}>
      <color attach="background" args={["#111514"]} />
      <fog attach="fog" args={["#111514", 8, 27]} />
      <mesh position={[0, 1, -6]}>
        <circleGeometry args={[3.1, 96]} />
        <meshBasicMaterial color="#ff793f" toneMapped={false} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -1.2, 0]}>
        <planeGeometry args={[40, 30, 30, 24]} />
        <meshBasicMaterial
          color="#61493a"
          wireframe
          transparent
          opacity={0.28}
        />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -1.19, 0]}>
        <planeGeometry args={[40, 30]} />
        <meshBasicMaterial color="#111514" transparent opacity={0.8} />
      </mesh>
      <Stars radius={30} depth={20} count={350} factor={1.4} fade speed={0.1} />
      <EffectComposer>
        <Bloom luminanceThreshold={0.3} intensity={0.65} mipmapBlur />
      </EffectComposer>
    </group>
  );
}
function Rail({
  statuses,
  onSelect,
  onLabels,
}: {
  statuses: boolean[];
  onSelect?: (i: number) => void;
  onLabels: (labels: NodeCaption[]) => void;
}) {
  const { camera, size, invalidate } = useThree();
  const stacked = size.width < 640;
  useEffect(() => {
    const view = camera as THREE.OrthographicCamera;
    view.zoom = Math.min(size.width / 17.5, size.height / (stacked ? 6 : 3.8));
    view.position.set(0, 0, 16);
    view.lookAt(0, 0, 0);
    view.updateProjectionMatrix();
    view.updateMatrixWorld();
    onLabels(
      Array.from({ length: 12 }, (_, i) => {
        const [x, y] = nodePosition(i, stacked);
        const point = new THREE.Vector3(x, y - 0.85, 0).project(view);
        return {
          left: (point.x + 1) * 50,
          top: (1 - point.y) * 50,
          label: nodeNames[i % 6],
        };
      }),
    );
    invalidate();
  }, [camera, size.width, size.height, stacked, invalidate, onLabels]);
  return (
    <>
      <ambientLight intensity={1.8} />
      <pointLight position={[0, 4, 4]} intensity={25} />
      <mesh position={[0, stacked ? 1 : -0.5, 0]}>
        <boxGeometry args={[15.8, 0.035, 0.04]} />
        <meshBasicMaterial color="#46504c" />
      </mesh>
      {stacked && (
        <mesh position={[0, -1.4, 0]}>
          <boxGeometry args={[15.8, 0.035, 0.04]} />
          <meshBasicMaterial color="#46504c" />
        </mesh>
      )}
      {!stacked && (
        <mesh>
          <boxGeometry args={[0.08, 2.2, 1]} />
          <meshPhysicalMaterial
            color="#94dfe5"
            transparent
            opacity={0.18}
            metalness={0.2}
            roughness={0.1}
          />
        </mesh>
      )}
      {Array.from({ length: 12 }, (_, i) => (
        <Float key={i} speed={1} floatIntensity={0.08} rotationIntensity={0.08}>
          <mesh
            position={nodePosition(i, stacked)}
            onClick={() => onSelect?.(i % 6)}
          >
            <icosahedronGeometry args={[0.42, 0]} />
            <meshStandardMaterial
              color={
                i < 6 ? "#f39c68" : statuses[i % 6] ? "#83c4a4" : "#e56d68"
              }
              emissive={
                i < 6 ? "#ab5025" : statuses[i % 6] ? "#195b45" : "#8c2929"
              }
              emissiveIntensity={0.5}
            />
            {onSelect && (
              <mesh
                onClick={(event) => {
                  event.stopPropagation();
                  onSelect(i % 6);
                }}
              >
                <sphereGeometry args={[0.6, 12, 8]} />
                <meshBasicMaterial transparent opacity={0} depthWrite={false} />
              </mesh>
            )}
          </mesh>
        </Float>
      ))}
    </>
  );
}
export default function Scene({
  pipeline = false,
  statuses = [],
  onSelect,
}: {
  pipeline?: boolean;
  statuses?: boolean[];
  onSelect?: (i: number) => void;
}) {
  const reduced = useReducedMotion(),
    ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(true),
    [webgl, setWebgl] = useState(false),
    [labels, setLabels] = useState<NodeCaption[]>([]);
  useEffect(() => {
    try {
      const c = document.createElement("canvas");
      const context = c.getContext("webgl2") || c.getContext("webgl");
      setWebgl(!!context);
      context?.getExtension("WEBGL_lose_context")?.loseContext();
    } catch {
      setWebgl(false);
    }
    const observer = new IntersectionObserver(([e]) =>
      setVisible(e.isIntersecting),
    );
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  return (
    <div
      ref={ref}
      className={pipeline ? "pipeline-scene" : "horizon-scene"}
      aria-label={
        pipeline
          ? "Legacy calls converted into parity-verified Orders v2 nodes"
          : "Ember sun setting over a wireframe horizon"
      }
    >
      {webgl && !reduced ? (
        <>
          <Canvas
            orthographic={pipeline}
            dpr={[1, 1.75]}
            frameloop={visible ? "always" : "never"}
            camera={{
              position: pipeline ? [0, 0, 16] : [0, 1, 9],
              fov: pipeline ? 48 : 50,
            }}
          >
            {pipeline ? (
              <Rail
                statuses={statuses}
                onSelect={onSelect}
                onLabels={setLabels}
              />
            ) : (
              <Horizon />
            )}
          </Canvas>
          {pipeline && (
            <div className="pipeline-captions">
              {labels.map((label, i) => (
                <span
                  key={i}
                  className="pipeline-node-caption"
                  style={{ left: `${label.left}%`, top: `${label.top}%` }}
                >
                  {label.label}
                </span>
              ))}
            </div>
          )}
        </>
      ) : (
        <div className={pipeline ? "static-rail" : "static-sun"}>
          {pipeline && (
            <div className="static-pipeline">
              {["Legacy checkout", "Orders v2 outcomes"].map((stage, j) => (
                <div key={stage}>
                  <strong>{stage}</strong>
                  <div>
                    {[
                      "Cancel",
                      "Decline",
                      "Duplicate",
                      "Refund",
                      "Rounding",
                      "Success",
                    ].map((name, i) => (
                      <span
                        key={name}
                        className={
                          j === 0
                            ? "legacy-node"
                            : statuses[i]
                              ? "passed-node"
                              : "failed-node"
                        }
                      >
                        <i aria-hidden="true">◆</i>
                        {name}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
