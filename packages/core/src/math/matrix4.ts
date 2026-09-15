import { serializable, serialize } from "../serialize";
import { MathUtils } from "./mathUtils";
import type { Plane } from "./plane";
import { Quaternion } from "./quaternion";
import { XYZ, type XYZLike } from "./xyz";

export interface Matrix4Options {
    array: Float32Array | ArrayLike<number>;
}

/**
 * A 4x4 transformation matrix, stored in COLUMN-MAJOR order (the same layout WebGL/three.js
 * expects, so it can be handed straight to the GPU without conversion).
 *
 * In CAD this is THE object used to describe "where something is in space": every shape, part,
 * sketch, or camera has a Matrix4 (its "placement"/"transform") that says how to move it from its
 * own local coordinate system into world space — combining translation, rotation and scale (and
 * optionally a mirror flip) into one object.
 *
 * It works using 4D "homogeneous coordinates": a 3D point (x, y, z) is treated internally as
 * (x, y, z, 1). Packing translation into a 4th row/column like this lets a single matrix multiply
 * express translation, rotation AND scale together, and lets transforms be chained with simple
 * matrix multiplication (see `multiply`) instead of juggling three separate operations by hand.
 *
 * Typical CAD uses of this class:
 *  - Placing a part/body in the scene (move/rotate/scale commands -> `fromTranslation` / `fromAxisRad` / `fromScale`).
 *  - Building assembly hierarchies: a child's world matrix = `parent.multiply(childLocalMatrix)`.
 *  - Converting a point between world space and a part's local space (`invert`, `ofPoint`).
 *  - Mirroring geometry across a plane (`createMirrorWithPlane`) — common for symmetric parts.
 *  - Feeding the renderer/GPU the final model matrix used to draw a shape.
 *  - Reading/writing an object's placement in a properties panel (`createFromTRS`, `getEulerAngles`, `getScale`).
 */
@serializable()
export class Matrix4 {
    // Backing storage: 16 numbers in column-major order, i.e.
    //   [ col0.x, col0.y, col0.z, col0.w,   col1.x, col1.y, col1.z, col1.w,
    //     col2.x, col2.y, col2.z, col2.w,   col3.x, col3.y, col3.z, col3.w ]
    // Columns 0-2 hold the rotation/scale basis vectors; column 3 (indices 12,13,14) holds the
    // translation (x, y, z), and index 15 is normally 1 for a standard affine transform.
    private readonly _array: Float32Array;

    constructor(options: Matrix4Options) {
        this._array = new Float32Array(options.array);
    }

    /** Exposes the raw 16 numbers so an object's placement can be serialized into (and restored from) a saved CAD document. */
    @serialize()
    get array(): ReadonlyArray<number> {
        return [...this._array];
    }

    /**
     * Computes the determinant of the matrix.
     * In CAD this is used to detect a degenerate/non-invertible transform (e.g. a part scaled to
     * zero on one axis), and its sign tells you whether the transform flips handedness — a
     * negative determinant means the geometry is mirrored, which matters for surface-normal
     * direction and face winding order when rendering.
     */
    public determinant(): number {
        const [a00, a01, a02, a03] = [this._array[0], this._array[1], this._array[2], this._array[3]];
        const [a10, a11, a12, a13] = [this._array[4], this._array[5], this._array[6], this._array[7]];
        const [a20, a21, a22, a23] = [this._array[8], this._array[9], this._array[10], this._array[11]];
        const [a30, a31, a32, a33] = [this._array[12], this._array[13], this._array[14], this._array[15]];

        const b0 = a00 * a11 - a01 * a10;
        const b1 = a00 * a12 - a02 * a10;
        const b2 = a01 * a12 - a02 * a11;
        const b3 = a20 * a31 - a21 * a30;
        const b4 = a20 * a32 - a22 * a30;
        const b5 = a21 * a32 - a22 * a31;
        const b6 = a00 * b5 - a01 * b4 + a02 * b3;
        const b7 = a10 * b5 - a11 * b4 + a12 * b3;
        const b8 = a20 * b2 - a21 * b1 + a22 * b0;
        const b9 = a30 * b2 - a31 * b1 + a32 * b0;

        return a13 * b6 - a03 * b7 + a33 * b8 - a23 * b9;
    }

    public toArray(): readonly number[] {
        return [...this._array];
    }

    /** Component-wise matrix addition. Not a "transform" in itself — mostly a low-level building block (e.g. for blending/averaging transforms) rather than something used directly to move CAD geometry. */
    public add(other: Matrix4): Matrix4 {
        const array = new Float32Array(16);
        for (let index = 0; index < 16; index++) {
            array[index] = this._array[index] + other._array[index];
        }
        return new Matrix4({ array });
    }

    /**
     * Computes the inverse of this matrix, or `undefined` if it isn't invertible (determinant is 0).
     * This is how CAD converts a point/direction from world space back into an object's own local
     * space — e.g. turning a mouse-picked world point into local sketch coordinates, or "undoing"
     * a placement to work with a shape's raw, unplaced geometry.
     */
    public invert(): Matrix4 | undefined {
        const [a00, a01, a02, a03] = [this._array[0], this._array[1], this._array[2], this._array[3]];
        const [a10, a11, a12, a13] = [this._array[4], this._array[5], this._array[6], this._array[7]];
        const [a20, a21, a22, a23] = [this._array[8], this._array[9], this._array[10], this._array[11]];
        const [a30, a31, a32, a33] = [this._array[12], this._array[13], this._array[14], this._array[15]];
        const b00 = a00 * a11 - a01 * a10;
        const b01 = a00 * a12 - a02 * a10;
        const b02 = a00 * a13 - a03 * a10;
        const b03 = a01 * a12 - a02 * a11;
        const b04 = a01 * a13 - a03 * a11;
        const b05 = a02 * a13 - a03 * a12;
        const b06 = a20 * a31 - a21 * a30;
        const b07 = a20 * a32 - a22 * a30;
        const b08 = a20 * a33 - a23 * a30;
        const b09 = a21 * a32 - a22 * a31;
        const b10 = a21 * a33 - a23 * a31;
        const b11 = a22 * a33 - a23 * a32;

        // Reuse the same cofactor terms as `determinant()` — bail out early if the matrix
        // collapses geometry to zero volume (e.g. a zero scale), since it has no inverse.
        let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
        if (det === 0) return undefined;
        det = 1.0 / det;

        return Matrix4.fromArray([
            (a11 * b11 - a12 * b10 + a13 * b09) * det,
            (a02 * b10 - a01 * b11 - a03 * b09) * det,
            (a31 * b05 - a32 * b04 + a33 * b03) * det,
            (a22 * b04 - a21 * b05 - a23 * b03) * det,
            (a12 * b08 - a10 * b11 - a13 * b07) * det,
            (a00 * b11 - a02 * b08 + a03 * b07) * det,
            (a32 * b02 - a30 * b05 - a33 * b01) * det,
            (a20 * b05 - a22 * b02 + a23 * b01) * det,
            (a10 * b10 - a11 * b08 + a13 * b06) * det,
            (a01 * b08 - a00 * b10 - a03 * b06) * det,
            (a30 * b04 - a31 * b02 + a33 * b00) * det,
            (a21 * b02 - a20 * b04 - a23 * b00) * det,
            (a11 * b07 - a10 * b09 - a12 * b06) * det,
            (a00 * b09 - a01 * b07 + a02 * b06) * det,
            (a31 * b01 - a30 * b03 - a32 * b00) * det,
            (a20 * b03 - a21 * b01 + a22 * b00) * det,
        ]);
    }

    /**
     * Matrix multiplication: composes two transforms into a single one.
     * This is the core operation for building up placements — e.g.
     * `childLocalMatrix.multiply(parentWorldMatrix)` gives a child part's world matrix inside an
     * assembly, or `translation.multiply(rotation)` combines a move and a rotate into one transform.
     * Order matters: `A.multiply(B)` applies A's transform first, then B's. Translation
     * lives in the last row here and `ofPoint` multiplies the point on the left
     * (`v' = v * M`), so composition reads left to right - the opposite of the
     * column-vector convention used by OpenGL-style maths libraries. Pivoting a
     * transform about a point therefore starts with the negative translation: see
     * `fromAxisRad`.
     */
    public multiply(other: Matrix4): Matrix4 {
        const array = new Array(16).fill(0);
        for (let i = 0; i < 4; i++) {
            for (let j = 0; j < 4; j++) {
                for (let k = 0; k < 4; k++) {
                    array[i * 4 + j] += this._array[i * 4 + k] * other._array[k * 4 + j];
                }
            }
        }
        return Matrix4.fromArray(array);
    }

    /** Approximate equality (tolerant of floating-point noise) — used to compare two placements without tiny rounding differences reporting a false "changed" state. */
    public equals(value: Matrix4): boolean {
        for (let i = 0; i < 16; i++) {
            if (!MathUtils.almostEqual(this._array[i], value._array[i])) return false;
        }
        return true;
    }

    public clone(): Matrix4 {
        return Matrix4.fromArray([...this._array]);
    }

    public static fromArray(array: ArrayLike<number>): Matrix4 {
        const result = new Float32Array(16);
        for (let index = 0; index < 16; index++) {
            result[index] = array[index];
        }
        return new Matrix4({ array: result });
    }

    /** The "no transform" matrix — every new object's placement effectively starts here before a move/rotate/scale is applied. */
    public static identity(): Matrix4 {
        return Matrix4.fromArray([
            1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0,
        ]);
    }

    public static zero(): Matrix4 {
        return Matrix4.fromArray(new Array(16).fill(0));
    }

    /**
     * Builds a rotation-only matrix from Euler angles (radians), rotating around X, then Y, then Z.
     * Handy when a UI lets a user type three separate rotation angles, but note Euler angles can
     * suffer from "gimbal lock" (losing a degree of freedom at certain orientations) — see
     * `Quaternion` for a representation that avoids this when composing or interpolating rotations.
     */
    public static fromEuler(x: number, y: number, z: number): Matrix4 {
        const cx = Math.cos(x);
        const sx = Math.sin(x);
        const cy = Math.cos(y);
        const sy = Math.sin(y);
        const cz = Math.cos(z);
        const sz = Math.sin(z);
        return Matrix4.fromArray([
            cy * cz,
            cx * sz + sx * sy * cz,
            sx * sz - cx * sy * cz,
            0,
            -cy * sz,
            cx * cz - sx * sy * sz,
            sx * cz + cx * sy * sz,
            0,
            sy,
            -sx * cy,
            cx * cy,
            0,
            0,
            0,
            0,
            1,
        ]);
    }

    /**
     * Builds a transform that rotates around an arbitrary axis line — defined by a point on the
     * axis (`position`) and a direction (`normal`) — by `radians`. This is exactly what a CAD
     * "Rotate" command needs: rotate this shape by N degrees around this edge/axis, not just around
     * the world origin. Internally it goes through a Quaternion (for a numerically clean rotation),
     * then shifts the pivot to `position` by translating there, rotating, and translating back.
     */
    public static fromAxisRad(position: XYZLike, normal: XYZLike, radians: number): Matrix4 {
        const axes = Quaternion.fromAxisAngle(normal, radians).toAxes();

        const { x, y, z } = position;
        return Matrix4.fromTranslation(-x, -y, -z).multiply(Matrix4.fromArray([...axes, x, y, z, 1]));
    }

    /** Builds a scaling transform — backs a CAD "Scale" command (independent x/y/z scale factors). */
    public static fromScale(x: number, y: number, z: number): Matrix4 {
        return Matrix4.fromArray([x, 0, 0, 0, 0, y, 0, 0, 0, 0, z, 0, 0, 0, 0, 1]);
    }

    /** Builds a translation transform — backs a CAD "Move" command. */
    public static fromTranslation(x: number, y: number, z: number): Matrix4 {
        return Matrix4.fromArray([1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, x, y, z, 1.0]);
    }

    /**
     * Builds a mirror (reflection) transform across an arbitrary plane.
     * Backs a CAD "Mirror" command — e.g. generating the symmetric half of a part across a
     * construction plane instead of modeling it twice by hand.
     */
    public static createMirrorWithPlane(plane: Plane): Matrix4 {
        const d = -plane.origin.dot(plane.normal);
        const x = plane.normal.x;
        const y = plane.normal.y;
        const z = plane.normal.z;
        const temp = -2 * x;
        const temp2 = -2 * y;
        const temp3 = -2 * z;
        return Matrix4.fromArray([
            temp * x + 1,
            temp2 * x,
            temp3 * x,
            0.0,
            temp * y,
            temp2 * y + 1,
            temp3 * y,
            0.0,
            temp * z,
            temp2 * z,
            temp3 * z + 1,
            0.0,
            temp * d,
            temp2 * d,
            temp3 * d,
            1.0,
        ]);
    }

    /**
     * Swaps rows and columns.
     * Used e.g. when interoperating with row-major APIs, or as part of computing the
     * inverse-transpose matrix needed to correctly transform surface normals when a shape has been
     * non-uniformly scaled (a plain forward transform would tilt normals off the surface).
     */
    public transpose(): Matrix4 {
        const result = new Float32Array(16);
        result[0] = this._array[0];
        result[1] = this._array[4];
        result[2] = this._array[8];
        result[3] = this._array[12];

        result[4] = this._array[1];
        result[5] = this._array[5];
        result[6] = this._array[9];
        result[7] = this._array[13];

        result[8] = this._array[2];
        result[9] = this._array[6];
        result[10] = this._array[10];
        result[11] = this._array[14];

        result[12] = this._array[3];
        result[13] = this._array[7];
        result[14] = this._array[11];
        result[15] = this._array[15];

        return new Matrix4({ array: result });
    }

    /**
     * Transforms a flat array of 3D points [x0,y0,z0, x1,y1,z1, ...] by this matrix, applying
     * rotation, scale AND translation, then dividing by `w` (the homogeneous coordinate).
     * This is how a shape's raw vertex data gets moved from its local geometry into world-space
     * positions for rendering or for geometric operations (measuring, boolean ops, exporting, etc.).
     */
    ofPoints(points: ArrayLike<number>): number[] {
        const result: number[] = [];
        for (let i = 0; i < points.length / 3; i++) {
            const x =
                points[3 * i] * this._array[0] +
                points[3 * i + 1] * this._array[4] +
                points[3 * i + 2] * this._array[8] +
                this._array[12];
            const y =
                points[3 * i] * this._array[1] +
                points[3 * i + 1] * this._array[5] +
                points[3 * i + 2] * this._array[9] +
                this._array[13];
            const z =
                points[3 * i] * this._array[2] +
                points[3 * i + 1] * this._array[6] +
                points[3 * i + 2] * this._array[10] +
                this._array[14];
            const w =
                points[3 * i] * this._array[3] +
                points[3 * i + 1] * this._array[7] +
                points[3 * i + 2] * this._array[11] +
                this._array[15];
            result.push(x / w, y / w, z / w);
        }
        return result;
    }

    /** Transforms a single 3D point — see `ofPoints`. */
    public ofPoint(point: XYZLike): XYZ {
        const result = this.ofPoints([point.x, point.y, point.z]);
        return new XYZ({ x: result[0], y: result[1], z: result[2] });
    }

    /**
     * Transforms a single direction vector — e.g. a surface normal, or an edge/axis direction.
     * Unlike `ofPoint`, translation is intentionally NOT applied here, since a direction has no
     * position of its own; only rotating/scaling it makes sense.
     */
    public ofVector(vector: XYZLike): XYZ {
        const result = this.ofVectors([vector.x, vector.y, vector.z]);
        return new XYZ({ x: result[0], y: result[1], z: result[2] });
    }

    /** Batch version of `ofVector`, for transforming many direction vectors at once (no translation applied). */
    public ofVectors(vectors: ArrayLike<number>): number[] {
        const result: number[] = [];
        for (let i = 0; i < vectors.length / 3; i++) {
            const x =
                vectors[3 * i] * this._array[0] +
                vectors[3 * i + 1] * this._array[4] +
                vectors[3 * i + 2] * this._array[8];
            const y =
                vectors[3 * i] * this._array[1] +
                vectors[3 * i + 1] * this._array[5] +
                vectors[3 * i + 2] * this._array[9];
            const z =
                vectors[3 * i] * this._array[2] +
                vectors[3 * i + 1] * this._array[6] +
                vectors[3 * i + 2] * this._array[10];
            result.push(x, y, z);
        }
        return result;
    }

    /** Reads just the translation (position) component of the matrix — e.g. to display "where is this object" in a properties panel. */
    public translationPart(): XYZ {
        return new XYZ({ x: this._array[12], y: this._array[13], z: this._array[14] });
    }

    /** Reads the scale factor along each local axis, by measuring the length of each basis column (how much each local axis has been stretched). */
    public getScale(): XYZ {
        const x = Math.hypot(this._array[0], this._array[1], this._array[2]);
        const y = Math.hypot(this._array[4], this._array[5], this._array[6]);
        const z = Math.hypot(this._array[8], this._array[9], this._array[10]);
        return new XYZ({ x, y, z });
    }

    /**
     * Decomposes the rotation part of the matrix back into pitch/yaw/roll angles (radians) — e.g.
     * to populate a rotation field in a properties panel after a user drags/rotates an object.
     * Handles the "gimbal lock" case (|m13| close to 1, i.e. looking straight up/down) separately,
     * since pitch and roll become ambiguous (interchangeable) there.
     */
    public getEulerAngles(): { pitch: number; yaw: number; roll: number } {
        const m = this._array;
        const m11 = m[0],
            m12 = m[4],
            m13 = m[8];
        const m22 = m[5],
            m23 = m[9];
        const m32 = m[6],
            m33 = m[10];

        let pitch = 0;
        const yaw = Math.asin(MathUtils.clamp(m13, -1, 1));
        let roll = 0;

        if (Math.abs(m13) < 0.9999999) {
            pitch = Math.atan2(-m23, m33);
            roll = Math.atan2(-m12, m11);
        } else {
            pitch = Math.atan2(m32, m22);
        }

        return { pitch, yaw, roll };
    }

    /**
     * Builds a full placement matrix from separate Translation, Rotation and Scale components
     * (TRS) — the standard way a CAD object's transform is stored and edited, since three
     * independent, human-readable components are far friendlier for a user/UI than 16 raw matrix
     * numbers. Rotation is converted through a Quaternion internally to avoid gimbal-lock artifacts.
     */
    public static createFromTRS(
        position: XYZLike,
        rotation: { pitch: number; yaw: number; roll: number },
        scale: XYZLike,
    ): Matrix4 {
        const quaternion = Quaternion.fromEuler(rotation.pitch, rotation.yaw, rotation.roll);
        const te = new Array(16).fill(0);

        const x = quaternion.x,
            y = quaternion.y,
            z = quaternion.z,
            w = quaternion.w;
        const x2 = x + x,
            y2 = y + y,
            z2 = z + z;
        const xx = x * x2,
            xy = x * y2,
            xz = x * z2;
        const yy = y * y2,
            yz = y * z2,
            zz = z * z2;
        const wx = w * x2,
            wy = w * y2,
            wz = w * z2;

        const sx = scale.x,
            sy = scale.y,
            sz = scale.z;

        // Rotation-times-scale basis vectors (each axis column is rotated, then scaled by sx/sy/sz).
        te[0] = (1 - (yy + zz)) * sx;
        te[1] = (xy + wz) * sx;
        te[2] = (xz - wy) * sx;
        te[3] = 0;

        te[4] = (xy - wz) * sy;
        te[5] = (1 - (xx + zz)) * sy;
        te[6] = (yz + wx) * sy;
        te[7] = 0;

        te[8] = (xz + wy) * sz;
        te[9] = (yz - wx) * sz;
        te[10] = (1 - (xx + yy)) * sz;
        te[11] = 0;

        // Translation column — the object's position.
        te[12] = position.x;
        te[13] = position.y;
        te[14] = position.z;
        te[15] = 1;

        return Matrix4.fromArray(te);
    }

    /**
     * Builds a rotation-only matrix from a Quaternion.
     * Used to bring a quaternion-based rotation (e.g. produced by smooth camera or object rotation,
     * which avoids gimbal lock) into the matrix form needed for rendering or for composing with
     * other transforms via `multiply`.
     */
    public static fromQuaternion(qua: Quaternion): Matrix4 {
        const x2 = qua.x * qua.x;
        const y2 = qua.y * qua.y;
        const z2 = qua.z * qua.z;

        const xx2 = x2 * qua.x;
        const xy2 = x2 * qua.y;
        const xz2 = x2 * qua.z;

        const yy2 = y2 * qua.y;
        const yz2 = y2 * qua.z;
        const zz2 = z2 * qua.z;

        const sy2 = y2 * qua.w;
        const sz2 = z2 * qua.w;
        const sx2 = x2 * qua.w;

        return Matrix4.fromArray([
            1 - yy2 - zz2,
            xy2 + sz2,
            xz2 - sy2,
            0,
            xy2 - sz2,
            1 - xx2 - zz2,
            yz2 + sx2,
            0,
            xz2 + sy2,
            yz2 - sx2,
            1 - xx2 - yy2,
            0,
            0,
            0,
            0,
            1,
        ]);
    }
}
