import { XYZ, type XYZLike } from "./xyz";

/**
 * A quaternion (w, x, y, z) representing a 3D rotation.
 *
 * CAD needs to rotate objects a lot — orbiting the camera, spinning a part to align it, animating
 * a preview, applying an axis-angle "Rotate" command — and quaternions are the standard tool for
 * this because, compared to plain rotation matrices or Euler angles (pitch/yaw/roll), they:
 *  - Never suffer from "gimbal lock" (losing a degree of freedom when two rotation axes line up),
 *    which Euler angles are prone to.
 *  - Compose cleanly and stay numerically stable even after many repeated rotations, whereas
 *    repeatedly multiplying rotation matrices can drift and needs re-orthogonalization.
 *  - Interpolate smoothly between two orientations (useful for animating a rotation), which is
 *    awkward to do correctly with Euler angles.
 *
 * A unit quaternion encodes "rotate by angle θ around axis a" as:
 *   w = cos(θ/2),  (x, y, z) = a * sin(θ/2)
 * i.e. `w` is the scalar/real part and `(x, y, z)` is the vector part pointing along the rotation
 * axis, scaled by the half-angle sine. This class is mostly used as an intermediate representation:
 * it gets built from an axis+angle or from Euler angles, then converted to a `Matrix4` (via
 * `toAxes()` / `Matrix4.fromQuaternion`) to actually place/render geometry.
 */
export class Quaternion {
    readonly w: number;
    readonly x: number;
    readonly y: number;
    readonly z: number;
    constructor(w = 1, x = 0, y = 0, z = 0) {
        this.w = w;
        this.x = x;
        this.y = y;
        this.z = z;
    }

    /**
     * Builds a quaternion that rotates by `rad` radians around `axis`.
     * This is the direct math behind a CAD "Rotate about this axis/edge by this angle" command.
     */
    static fromAxisAngle(axis: XYZLike, rad: number): Quaternion {
        const sin = Math.sin(rad * 0.5);
        const cos = Math.cos(rad * 0.5);
        return new Quaternion(cos, axis.x * sin, axis.y * sin, axis.z * sin);
    }

    /** Negates the vector part. For a unit quaternion this equals the inverse — i.e. the "opposite" rotation. */
    conjugate(): Quaternion {
        return new Quaternion(this.w, -this.x, -this.y, -this.z);
    }

    /** The inverse rotation (same as `conjugate` for a unit-length quaternion) — used to "undo" a rotation. */
    invert(): Quaternion {
        return this.conjugate();
    }

    /**
     * Rotates a single vector by this quaternion, using the standard "sandwich product"
     * q * v * q⁻¹ (treating the vector as a quaternion with w = 0). This lets a shape's points,
     * normals or directions be rotated directly, without first converting the quaternion to a
     * matrix.
     */
    rotateVector(vec3: XYZLike): XYZ {
        const q = new Quaternion(0, vec3.x, vec3.y, vec3.z);
        const r = this.multiply(q).multiply(this.conjugate());
        return new XYZ({ x: r.x, y: r.y, z: r.z });
    }

    /**
     * Converts this quaternion into the equivalent 3x3 rotation basis, laid out as a 12-number
     * column-major array (3 columns of 4, with each column's 4th/"w" slot padded to 0 so the
     * result can be dropped straight into a `Matrix4`'s array — see `Matrix4.fromAxisRad`, which
     * uses this to build a full rotate-around-an-arbitrary-axis transform).
     */
    toAxes() {
        const { x, y, z, w } = this;
        const x2 = x + x;
        const y2 = y + y;
        const z2 = z + z;
        const xx = x * x2;
        const xy = x * y2;
        const xz = x * z2;
        const yy = y * y2;
        const yz = y * z2;
        const zz = z * z2;
        const wx = w * x2;
        const wy = w * y2;
        const wz = w * z2;
        return [
            1.0 - (yy + zz),
            xy + wz,
            xz - wy,
            0.0,
            xy - wz,
            1.0 - (xx + zz),
            yz + wx,
            0.0,
            xz + wy,
            yz - wx,
            1.0 - (xx + yy),
            0.0,
        ];
    }

    /** Component-wise addition — a low-level building block (e.g. for averaging/blending nearby rotations), not itself a valid rotation until re-normalized. */
    add(q: Quaternion): Quaternion {
        return new Quaternion(this.w + q.w, this.x + q.x, this.y + q.y, this.z + q.z);
    }
    /** Component-wise subtraction — see `add`. */
    subtract(q: Quaternion): Quaternion {
        return new Quaternion(this.w - q.w, this.x - q.x, this.y - q.y, this.z - q.z);
    }
    /**
     * Quaternion multiplication: composes two rotations into one, the quaternion equivalent of
     * `Matrix4.multiply`. `this.multiply(q)` means "apply `q`'s rotation first, then this
     * quaternion's rotation" — used to chain rotations, e.g. combining a user's incremental drag
     * rotation with the object's existing orientation.
     */
    multiply(q: Quaternion): Quaternion {
        const { w: w1, x: x1, y: y1, z: z1 } = this;
        const { w: w2, x: x2, y: y2, z: z2 } = q;

        return new Quaternion(
            w1 * w2 - x1 * x2 - y1 * y2 - z1 * z2,
            w1 * x2 + x1 * w2 + y1 * z2 - z1 * y2,
            w1 * y2 - x1 * z2 + y1 * w2 + z1 * x2,
            w1 * z2 + x1 * y2 - y1 * x2 + z1 * w2,
        );
    }
    /**
     * Decomposes this quaternion back into Euler angles (x/y/z, radians) — e.g. to display a
     * rotation as three numbers in a properties panel. `sig` guards against the gimbal-lock case
     * (axes lining up near ±90° on the middle axis), where x and z rotation become interchangeable
     * and are handled as a special case instead of producing unstable/undefined angles.
     */
    toEuler(): { x: number; y: number; z: number } {
        const sig = 0.499;
        const [qw, qx, qy, qz] = [this.w, this.x, this.y, this.z];
        const [sqw, sqx, sqy, sqz] = [qw * qw, qx * qx, qy * qy, qz * qz];
        const unit = sqx + sqz + sqy + sqw;
        const test = qx * qz + qy * qw;
        if (test > sig * unit) {
            return {
                x: 0,
                y: Math.PI / 4,
                z: Math.atan2(qx, qw) * 2,
            };
        } else if (test < -sig * unit) {
            return {
                x: 0,
                y: -Math.PI / 4,
                z: Math.atan2(qx, qw) * 2,
            };
        } else {
            return {
                x: Math.atan2(2 * (-qy * qz + qx * qw), 1 - 2 * (sqx + sqy)),
                y: Math.asin(2 * (qx * qz + qy * qw)),
                z: Math.atan2(2 * (-qx * qy + qz * qw), 1 - 2 * (sqy + sqz)),
            };
        }
    }

    /**
     * Builds a quaternion from Euler angles (roll, pitch, yaw — radians), by composing three
     * single-axis rotations. This lets a CAD UI accept the familiar "three angles" input for
     * rotation while the app still stores/composes the rotation internally as a quaternion, getting
     * gimbal-lock-free behavior for free (see `Matrix4.createFromTRS`, which uses this).
     */
    static fromEuler(roll: number, pitch: number, yaw: number): Quaternion {
        const halfRoll = roll * 0.5;
        const halfPitch = pitch * 0.5;
        const halfYaw = yaw * 0.5;

        const cr = Math.cos(halfRoll);
        const sr = Math.sin(halfRoll);
        const cp = Math.cos(halfPitch);
        const sp = Math.sin(halfPitch);
        const cy = Math.cos(halfYaw);
        const sy = Math.sin(halfYaw);

        return new Quaternion(
            -sr * sp * sy + cr * cp * cy,
            sr * cp * cy + cr * sp * sy,
            -sr * cp * sy + cr * sp * cy,
            cr * cp * sy + sr * sp * cy,
        );
    }
}
