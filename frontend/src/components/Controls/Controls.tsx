/**
 * Camera controls component with orbit controls.
 */

import { useRef, useEffect } from 'react';
import { OrbitControls as DreiOrbitControls } from '@react-three/drei';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { OrbitControls as OrbitControlsType } from 'three-stdlib';

interface ControlsProps {
  targetPosition?: [number, number, number];
  autoRotate?: boolean;
  onResetView?: () => void;
}

export function Controls({
  targetPosition,
  autoRotate = false,
}: ControlsProps) {
  const controlsRef = useRef<OrbitControlsType>(null);
  const { camera } = useThree();

  // Animate to target position when it changes
  useEffect(() => {
    if (targetPosition && controlsRef.current) {
      const controls = controlsRef.current;
      const target = new THREE.Vector3(...targetPosition);

      // Animate camera to look at target
      const startTarget = controls.target.clone();
      const startPosition = camera.position.clone();

      // Calculate new camera position (maintain distance but point at target)
      const distance = startPosition.distanceTo(startTarget);
      const direction = new THREE.Vector3()
        .subVectors(startPosition, startTarget)
        .normalize();
      const endPosition = target.clone().add(direction.multiplyScalar(distance));

      // Simple animation
      let t = 0;
      const animate = () => {
        t += 0.05;
        if (t >= 1) {
          controls.target.copy(target);
          camera.position.copy(endPosition);
          controls.update();
          return;
        }

        // Lerp
        controls.target.lerpVectors(startTarget, target, t);
        camera.position.lerpVectors(startPosition, endPosition, t);
        controls.update();

        requestAnimationFrame(animate);
      };

      animate();
    }
  }, [targetPosition, camera]);

  return (
    <DreiOrbitControls
      ref={controlsRef}
      makeDefault
      autoRotate={autoRotate}
      autoRotateSpeed={0.5}
      enableDamping
      dampingFactor={0.1}
      minDistance={0.5}
      maxDistance={30}
    />
  );
}
