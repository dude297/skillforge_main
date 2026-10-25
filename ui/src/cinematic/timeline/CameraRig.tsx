// Applies timeline/camera.ts to the R3F camera every rendered frame. Reads the clock directly: no React state.
import { useFrame } from "@react-three/fiber";
import type { PerspectiveCamera } from "three";
import { cameraAt, newPose } from "./camera";
import type { Clock } from "./clock";

const pose = newPose();

export function CameraRig({ clock }: { clock: Clock }) {
  useFrame((state) => {
    const cam = state.camera as PerspectiveCamera;
    const { width, height } = state.size;
    cameraAt(clock.t, width / height, pose);
    cam.position.set(pose.px, pose.py, pose.pz);
    cam.up.set(0, 1, 0); // never any roll
    cam.lookAt(pose.tx, pose.ty, pose.tz);
    cam.fov = pose.fov;
    if (pose.shift > 0.001) cam.setViewOffset(width, height, -pose.shift * width, 0, width, height);
    else if (cam.view?.enabled) cam.clearViewOffset();
    else cam.updateProjectionMatrix();
  }, -2);
  return null;
}
