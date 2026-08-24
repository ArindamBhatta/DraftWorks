// Part of the Chili3d Project, under the LGPL-3.0 License.
// See LICENSE-chili-wasm.text file in the project root for full license information.

#include <emscripten/bind.h>
#include <emscripten/val.h>

#include "shared.hpp"
#include "utils.hpp"
#include <BRepAlgoAPI_BooleanOperation.hxx>
#include <BRepAlgoAPI_Common.hxx>
#include <BRepAlgoAPI_Cut.hxx>
#include <BRepAlgoAPI_Defeaturing.hxx>
#include <BRepAlgoAPI_Fuse.hxx>
#include <BRepBuilderAPI_GTransform.hxx>
#include <BRepBuilderAPI_MakeEdge.hxx>
#include <BRepBuilderAPI_MakeFace.hxx>
#include <BRepBuilderAPI_MakePolygon.hxx>
#include <BRepBuilderAPI_MakeSolid.hxx>
#include <BRepBuilderAPI_MakeVertex.hxx>
#include <BRepBuilderAPI_MakeWire.hxx>
#include <BRepBuilderAPI_Sewing.hxx>
#include <BRepBuilderAPI_Transform.hxx>
#include <BRepCheck_Analyzer.hxx>
#include <BRepFeat_MakePrism.hxx>
#include <BRepFilletAPI_MakeChamfer.hxx>
#include <BRepFilletAPI_MakeFillet.hxx>
#include <BRepLib.hxx>
#include <BRepOffsetAPI_MakePipe.hxx>
#include <BRepOffsetAPI_MakePipeShell.hxx>
#include <BRepOffsetAPI_MakeThickSolid.hxx>
#include <BRepOffsetAPI_ThruSections.hxx>
#include <BRepPrimAPI_MakeBox.hxx>
#include <BRepPrimAPI_MakeCone.hxx>
#include <BRepPrimAPI_MakeCylinder.hxx>
#include <BRepPrimAPI_MakePrism.hxx>
#include <BRepPrimAPI_MakeRevol.hxx>
#include <BRepPrimAPI_MakeSphere.hxx>
#include <BRepProj_Projection.hxx>
#include <BRepTools.hxx>
#include <BRepTools_ReShape.hxx>
#include <ChFi2d_Builder.hxx>
#include <ChFi2d_ChamferAPI.hxx>
#include <ChFi2d_FilletAPI.hxx>
#include <GeomAPI_ProjectPointOnCurve.hxx>
#include <Geom_BezierCurve.hxx>
#include <Geom_Line.hxx>
#include <Geom_TrimmedCurve.hxx>
#include <ShapeAnalysis_Edge.hxx>
#include <ShapeAnalysis_WireOrder.hxx>
#include <ShapeFix_Face.hxx>
#include <ShapeFix_FixSmallFace.hxx>
#include <ShapeFix_Shape.hxx>
#include <ShapeFix_Solid.hxx>
#include <ShapeFix_Wire.hxx>
#include <ShapeUpgrade_UnifySameDomain.hxx>
#include <TopExp.hxx>
#include <TopExp_Explorer.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Iterator.hxx>
#include <TopoDS_Shape.hxx>
#include <gp_Ax2.hxx>
#include <gp_Circ.hxx>

using namespace emscripten;

struct ShapeResult {
    TopoDS_Shape shape;
    bool isOk;
    std::string error;
};

struct RemoveFilletResult {
    TopoDS_Shape shape;
    bool isOk;
    std::string error;
    ShapeArray newEdges;
};

struct ShapesResult {
    ShapeArray shapes;
    bool isOk;
    std::string error;
};

// Compute the plane formed by two edges at their shared vertex from their tangent vectors.
static std::optional<gp_Dir> computeNormal(const TopoDS_Edge& edge1, const TopoDS_Edge& edge2, const TopoDS_Vertex& vertex)
{
    double p1 = BRep_Tool::Parameter(vertex, edge1);
    double p2 = BRep_Tool::Parameter(vertex, edge2);

    double cf, cl;
    Handle(Geom_Curve) curve1 = BRep_Tool::Curve(edge1, cf, cl);
    Handle(Geom_Curve) curve2 = BRep_Tool::Curve(edge2, cf, cl);

    gp_Pnt pt;
    gp_Vec tan1, tan2;
    curve1->D1(p1, pt, tan1);
    curve2->D1(p2, pt, tan2);

    gp_Vec normal = tan1.Crossed(tan2);
    if (normal.Magnitude() < Precision::Angular()) {
        return std::nullopt;
    }

    return gp_Dir(normal);
}

// Find the common vertex shared by two edges. Returns null if none.
static TopoDS_Vertex findCommonVertex(const TopoDS_Edge& edge1, const TopoDS_Edge& edge2)
{
    TopExp_Explorer v1(edge1, TopAbs_VERTEX);
    for (; v1.More(); v1.Next()) {
        auto vertex1 = v1.Current();
        TopExp_Explorer v2(edge2, TopAbs_VERTEX);
        for (; v2.More(); v2.Next()) {
            if (vertex1.IsSame(v2.Current())) {
                return TopoDS::Vertex(vertex1);
            }
        }
    }
    return TopoDS_Vertex();
}

// Build a JS array [edge1, edge2, edge3] from three edges.
static val buildEdgeTriple(const TopoDS_Edge& a, const TopoDS_Edge& b, const TopoDS_Edge& c)
{
    val edges = val::array();
    edges.call<void>("push", a);
    edges.call<void>("push", b);
    edges.call<void>("push", c);
    return edges;
}

// The curve underlying an edge with its parameter range, unwrapping trimmed curves.
static Handle(Geom_Curve) basisCurve(const TopoDS_Edge& edge, double& first, double& last)
{
    Handle(Geom_Curve) curve = BRep_Tool::Curve(edge, first, last);
    if (auto trimmed = Handle(Geom_TrimmedCurve)::DownCast(curve))
        curve = trimmed->BasisCurve();
    return curve;
}

struct CornerPlane {
    gp_Pnt point; // intersection of the two support lines
    gp_Dir normal; // normal of the plane containing both edges
    double param1 = 0.0; // corner parameter on the first support line
    double param2 = 0.0; // corner parameter on the second support line
};

// Compute the corner reference point and the plane for a 2D fillet/chamfer between two
// edges. Only straight edges are supported: they must be coplanar and non-parallel, and
// the corner is the intersection of their support lines, which need not lie on the
// edges themselves.
static std::optional<CornerPlane> computeCornerPlane(const TopoDS_Edge& edge1, const TopoDS_Edge& edge2,
    std::string& error)
{
    double f, l;
    Handle(Geom_Line) line1 = Handle(Geom_Line)::DownCast(basisCurve(edge1, f, l));
    Handle(Geom_Line) line2 = Handle(Geom_Line)::DownCast(basisCurve(edge2, f, l));
    if (line1.IsNull() || line2.IsNull()) {
        error = "Edges must be Line";
        return std::nullopt;
    }

    gp_Vec d1(line1->Lin().Direction());
    gp_Vec d2(line2->Lin().Direction());
    gp_Vec normal = d1.Crossed(d2);
    if (normal.Magnitude() < Precision::Angular()) {
        error = "Edges must not be parallel";
        return std::nullopt;
    }

    gp_Vec p12(line1->Lin().Location(), line2->Lin().Location());
    if (std::abs(p12.Dot(normal) / normal.Magnitude()) > Precision::Confusion()) {
        error = "Edges must be coplanar";
        return std::nullopt;
    }

    // intersection of the support lines: p12 = t1 * d1 - t2 * d2, solved by crossing with d2 and d1 respectively
    double denom = normal.SquareMagnitude();
    double t1 = p12.Crossed(d2).Dot(normal) / denom;
    double t2 = p12.Crossed(d1).Dot(normal) / denom;
    return CornerPlane { line1->Lin().Location().Translated(d1.Multiplied(t1)), gp_Dir(normal), t1, t2 };
}

// Build an edge whose range covers the corner parameter p. When p cuts the edge in two,
// only the longer side is kept, so that fillets/chamfers consume the shorter side; when p
// lies outside, the edge is extended up to p (OCCT fillets can trim but never prolongate).
static TopoDS_Edge edgeThroughCorner(const Handle(Geom_Curve) & basis, double first, double last, double p)
{
    if (p > first && p < last) {
        return p - first >= last - p ? BRepBuilderAPI_MakeEdge(basis, first, p).Edge()
                                     : BRepBuilderAPI_MakeEdge(basis, p, last).Edge();
    }
    return BRepBuilderAPI_MakeEdge(basis, std::min(first, p), std::max(last, p)).Edge();
}

// Endpoints of an edge, evaluated on its underlying curve.
static void edgeEndPoints(const TopoDS_Edge& edge, gp_Pnt& start, gp_Pnt& end)
{
    double first, last;
    Handle(Geom_Curve) curve = BRep_Tool::Curve(edge, first, last);
    start = curve->Value(first);
    end = curve->Value(last);
}

// ChFi2d may trim either side of the corner, so the kept side is rebuilt
// deterministically: from the fillet tangent point (whichever arc endpoint lies on this
// curve) to the end of the edge farthest from the corner.
static TopoDS_Edge edgeToFarEnd(const Handle(Geom_Curve) & basis, double first, double last,
    double cornerParam, const gp_Pnt& arcStart, const gp_Pnt& arcEnd)
{
    GeomAPI_ProjectPointOnCurve fromStart(arcStart, basis);
    GeomAPI_ProjectPointOnCurve fromEnd(arcEnd, basis);
    double tangent = fromStart.LowerDistance() <= fromEnd.LowerDistance()
        ? fromStart.LowerDistanceParameter()
        : fromEnd.LowerDistanceParameter();
    double farEnd = cornerParam - first >= last - cornerParam ? first : last;
    return BRepBuilderAPI_MakeEdge(basis, std::min(tangent, farEnd), std::max(tangent, farEnd)).Edge();
}

class ShapeFactory {
public:
    static ShapeResult box(const Pln& ax3, double x, double y, double z)
    {
        gp_Pln pln = Pln::toPln(ax3);
        BRepBuilderAPI_MakeFace makeFace(pln, 0, x, 0, y);
        if (!makeFace.IsDone()) {
            return ShapeResult { TopoDS_Shape(), false, "Failed to create box" };
        }

        gp_Vec vec(pln.Axis().Direction());
        vec.Multiply(z);
        BRepPrimAPI_MakePrism box(makeFace.Face(), vec);
        if (!box.IsDone()) {
            return ShapeResult { TopoDS_Shape(), false, "Failed to create box" };
        }
        return ShapeResult { box.Shape(), true, "" };
    }

    static ShapeResult cone(const Vector3& normal, const Vector3& center, double radius, double radiusUp, double height)
    {
        gp_Ax2 ax2(Vector3::toPnt(center), Vector3::toDir(normal));
        TopoDS_Shape cone = BRepPrimAPI_MakeCone(ax2, radius, radiusUp, height).Shape();
        return ShapeResult { cone, true, "" };
    }

    static ShapeResult sphere(const Vector3& center, double radius)
    {
        TopoDS_Shape sphere = BRepPrimAPI_MakeSphere(Vector3::toPnt(center), radius).Shape();
        return ShapeResult { sphere, true, "" };
    }

    static ShapeResult ellipse(const Vector3& normal, const Vector3& center, const Vector3& xvec, double majorRadius,
        double minorRadius)
    {
        gp_Ax2 ax2(Vector3::toPnt(center), Vector3::toDir(normal), Vector3::toDir(xvec));
        gp_Elips ellipse(ax2, majorRadius, minorRadius);
        BRepBuilderAPI_MakeEdge edge(ellipse);
        if (!edge.IsDone()) {
            return ShapeResult { TopoDS_Shape(), false, "Failed to create ellipse" };
        }
        return ShapeResult { edge.Edge(), true, "" };
    }

    /**
     * TODO
     */
    static ShapeResult ellipsoid(const Vector3& normal, const Vector3& center, const Vector3& xvec, double xRadius,
        double yRadius, double zRadius)
    {
        TopoDS_Shape sphere = BRepPrimAPI_MakeSphere(1).Solid();

        gp_GTrsf transform;
        transform.SetValue(1, 1, xRadius);
        transform.SetValue(2, 2, yRadius);
        transform.SetValue(3, 3, zRadius);
        transform.SetTranslationPart(gp_XYZ(center.x, center.y, center.z));

        BRepBuilderAPI_GTransform builder(sphere, transform);
        if (builder.IsDone()) {
            TopoDS_Shape ellipsoid = builder.Shape();
            return ShapeResult { ellipsoid, true, "" };
        }
        return ShapeResult { TopoDS_Shape(), false, "" };
    }

    static ShapeResult pyramid(const Pln& ax3, double x, double y, double z)
    {
        if (abs(x) <= Precision::Confusion() || abs(y) <= Precision::Confusion() || abs(z) <= Precision::Confusion()) {
            return ShapeResult { TopoDS_Shape(), false, "Invalid dimensions" };
        }

        gp_Pln pln = Pln::toPln(ax3);
        auto xvec = gp_Vec(pln.XAxis().Direction()).Multiplied(x);
        auto yvec = gp_Vec(pln.YAxis().Direction()).Multiplied(y);
        auto zvec = gp_Vec(pln.Axis().Direction()).Multiplied(z);
        auto p1 = pln.Location();
        auto p2 = p1.Translated(xvec);
        auto p3 = p1.Translated(xvec).Translated(yvec);
        auto p4 = p1.Translated(yvec);
        auto top = pln.Location().Translated((xvec + yvec) * 0.5 + zvec);

        std::vector<TopoDS_Face> faces = {
            TopoDS::Face(pointsToFace({ p1, p2, p3, p4, p1 }).shape), TopoDS::Face(pointsToFace({ p1, p2, top, p1 }).shape),
            TopoDS::Face(pointsToFace({ p2, p3, top, p2 }).shape), TopoDS::Face(pointsToFace({ p3, p4, top, p3 }).shape),
            TopoDS::Face(pointsToFace({ p4, p1, top, p4 }).shape)
        };

        return facesToSolid(faces);
    }

    static ShapeResult pointsToFace(std::vector<gp_Pnt>&& points)
    {
        auto wire = pointsToWire(points);
        if (!wire.isOk) {
            return wire;
        }

        BRepBuilderAPI_MakeFace face(TopoDS::Wire(wire.shape));
        if (!face.IsDone()) {
            return ShapeResult { TopoDS_Shape(), false, "Failed to create face" };
        }
        return ShapeResult { face.Face(), true, "" };
    }

    static ShapeResult pointsToWire(std::vector<gp_Pnt>& points)
    {
        BRepBuilderAPI_MakePolygon poly;
        for (auto& p : points) {
            poly.Add(p);
        }
        if (!poly.IsDone()) {
            return ShapeResult { TopoDS_Shape(), false, "Failed to create polygon" };
        }
        return ShapeResult { poly.Wire(), true, "" };
    }

    static ShapeResult facesToSolid(const std::vector<TopoDS_Face>& faces)
    {
        TopoDS_Shell shell;
        BRep_Builder shellBuilder;
        shellBuilder.MakeShell(shell);
        for (const auto& face : faces) {
            shellBuilder.Add(shell, face);
        }

        BRepBuilderAPI_MakeSolid solidBuilder(shell);
        if (!solidBuilder.IsDone()) {
            return ShapeResult { TopoDS_Shape(), false, "Failed to create solid" };
        }

        return ShapeResult { solidBuilder.Solid(), true, "" };
    }

    static ShapeResult cylinder(const Vector3& normal, const Vector3& center, double radius, double height)
    {
        gp_Ax2 ax2(Vector3::toPnt(center), Vector3::toDir(normal));
        BRepPrimAPI_MakeCylinder cylinder(ax2, radius, height);
        cylinder.Build();
        if (!cylinder.IsDone()) {
            return ShapeResult { TopoDS_Shape(), false, "Failed to create cylinder" };
        }
        return ShapeResult { cylinder.Solid(), true, "" };
    }

    static ShapeResult sweep(const ShapeArray& sections, const TopoDS_Wire& path, bool isFrenet, bool isForceC1)
    {
        BRepOffsetAPI_MakePipeShell pipe(path);
        if (isFrenet) {
            pipe.SetMode(isFrenet);
        }

        if (isForceC1) {
            pipe.SetTransitionMode(BRepBuilderAPI_RoundCorner);
            pipe.SetForceApproxC1(isForceC1);
        } else {
            pipe.SetTransitionMode(BRepBuilderAPI_RightCorner);
        }

        std::vector<TopoDS_Shape> shapesVec = vecFromJSArray<TopoDS_Shape>(sections);
        for (const auto& shape : shapesVec) {
            pipe.Add(shape);
        }

        pipe.Build();
        pipe.MakeSolid();

        if (!pipe.IsDone()) {
            return ShapeResult { TopoDS_Shape(), false, "Failed to sweep profile" };
        }
        return ShapeResult { pipe.Shape(), true, "" };
    }

    static ShapeResult revolve(const TopoDS_Shape& profile, const Ax1& axis, double rad)
    {
        BRepPrimAPI_MakeRevol revol(profile, Ax1::toAx1(axis), rad);
        if (!revol.IsDone()) {
            return ShapeResult { TopoDS_Shape(), false, "Failed to revolve profile" };
        }
        return ShapeResult { revol.Shape(), true, "" };
    }

    static ShapeResult prism(const TopoDS_Shape& profile, const Vector3& vec)
    {
        gp_Vec vec3 = Vector3::toVec(vec);
        BRepPrimAPI_MakePrism prism(profile, vec3);
        if (!prism.IsDone()) {
            return ShapeResult { TopoDS_Shape(), false, "Failed to create prism" };
        }
        return ShapeResult { prism.Shape(), true, "" };
    }

    static ShapeResult pushPull(const TopoDS_Shape& sbase, const TopoDS_Shape& pbase, const Vector3& vec)
    {
        gp_Vec v = Vector3::toVec(vec);
        gp_Trsf trsf;
        trsf.SetTranslation(v);
        BRepBuilderAPI_Transform transform(trsf);
        transform.Perform(pbase);
        gp_Dir dir(v);
        auto sur = BRep_Tool::Surface(TopoDS::Face(pbase));
        auto plane = Handle(Geom_Plane)::DownCast(sur);
        auto method = plane->Pln().Axis().Direction().Dot(dir) > 0 ? 1 : 0;
        if (pbase.Orientation() == TopAbs_REVERSED) {
            method = 1 - method;
        }
        BRepFeat_MakePrism prism(sbase, pbase, TopoDS::Face(transform.Shape()), dir, method, false);
        prism.Perform(v.Magnitude());
        if (!prism.IsDone()) {
            return ShapeResult { TopoDS_Shape(), false, "Failed to create prism" };
        }
        return ShapeResult { prism.Shape(), true, "" };
    }

    static ShapeResult polygon(const Vector3Array& points)
    {
        std::vector<Vector3> vector3s = vecFromJSArray<Vector3>(points);
        std::vector<gp_Pnt> pnts;
        for (auto& p : vector3s) {
            pnts.push_back(Vector3::toPnt(p));
        }
        return pointsToWire(pnts);
    }

    static ShapeResult arc(const Vector3& normal, const Vector3& center, const Vector3& start, double rad)
    {
        gp_Pnt centerPnt = Vector3::toPnt(center);
        gp_Pnt startPnt = Vector3::toPnt(start);
        gp_Dir xvec = gp_Dir(startPnt.XYZ() - centerPnt.XYZ());
        gp_Ax2 ax2(centerPnt, Vector3::toDir(normal), xvec);
        gp_Circ circ(ax2, centerPnt.Distance(startPnt));
        double startAng(0), endAng(rad);
        if (rad < 0) {
            startAng = Math::PI_2 + rad;
            endAng = Math::PI_2;
        }
        BRepBuilderAPI_MakeEdge edge(circ, startAng, endAng);
        if (!edge.IsDone()) {
            return ShapeResult { TopoDS_Shape(), false, "Failed to create arc" };
        }
        return ShapeResult { edge.Edge(), true, "" };
    }

    static ShapeResult circle(const Vector3& normal, const Vector3& center, double radius)
    {
        gp_Ax2 ax2(Vector3::toPnt(center), Vector3::toDir(normal));
        gp_Circ circ(ax2, radius);
        BRepBuilderAPI_MakeEdge edge(circ);
        if (!edge.IsDone()) {
            return ShapeResult { TopoDS_Shape(), false, "Failed to create circle" };
        }
        return ShapeResult { edge.Edge(), true, "" };
    }

    static ShapeResult rect(const Pln& pln, double width, double height)
    {
        BRepBuilderAPI_MakeFace makeFace(Pln::toPln(pln), 0, width, 0, height);
        if (!makeFace.IsDone()) {
            return ShapeResult { TopoDS_Shape(), false, "Failed to create rectangle" };
        }
        return ShapeResult { makeFace.Face(), true, "" };
    }

    static ShapeResult bezier(const Vector3Array& points, const NumberArray& weights)
    {
        std::vector<Vector3> pts = vecFromJSArray<Vector3>(points);
        NCollection_Array1<gp_Pnt> arrayofPnt(1, pts.size());
        for (int i = 0; i < pts.size(); i++) {
            arrayofPnt.SetValue(i + 1, Vector3::toPnt(pts[i]));
        }

        std::vector<double> wts = vecFromJSArray<double>(weights);
        NCollection_Array1<double> arrayOfWeight(1, wts.size());
        for (int i = 0; i < wts.size(); i++) {
            arrayOfWeight.SetValue(i + 1, wts[i]);
        }

        Handle(Geom_Curve) curve = wts.size() > 0 ? new Geom_BezierCurve(arrayofPnt, arrayOfWeight) : new Geom_BezierCurve(arrayofPnt);
        BRepBuilderAPI_MakeEdge edge(curve);
        if (!edge.IsDone()) {
            return ShapeResult { TopoDS_Shape(), false, "Failed to create bezier" };
        }
        return ShapeResult { edge.Edge(), true, "" };
    }

    static ShapeResult point(const Vector3& point)
    {
        BRepBuilderAPI_MakeVertex makeVertex(Vector3::toPnt(point));
        if (!makeVertex.IsDone()) {
            return ShapeResult { TopoDS_Shape(), false, "Failed to create point" };
        }
        return ShapeResult { makeVertex.Vertex(), true, "" };
    }

    static ShapeResult line(const Vector3& start, const Vector3& end)
    {
        BRepBuilderAPI_MakeEdge makeEdge(Vector3::toPnt(start), Vector3::toPnt(end));
        if (!makeEdge.IsDone()) {
            return ShapeResult { TopoDS_Shape(), false, "Failed to create line" };
        }
        return ShapeResult { makeEdge.Edge(), true, "" };
    }

    static void orderEdge(BRepBuilderAPI_MakeWire& wire, const std::vector<TopoDS_Edge>& edges)
    {
        ShapeAnalysis_WireOrder order;
        ShapeAnalysis_Edge analysis;
        for (auto& edge : edges) {
            order.Add(BRep_Tool::Pnt(analysis.FirstVertex(edge)).XYZ(),
                BRep_Tool::Pnt(analysis.LastVertex(edge)).XYZ());
        }
        order.Perform(true);
        if (order.IsDone()) {
            for (int i = 0; i < order.NbEdges(); i++) {
                int index = order.Ordered(i + 1);
                auto edge = edges[abs(index) - 1];
                if (index < 0) {
                    edge.Reverse();
                }
                wire.Add(edge);
            }
        }
    }

    static ShapeResult wire(const EdgeArray& edges)
    {
        std::vector<TopoDS_Edge> edgesVec = vecFromJSArray<TopoDS_Edge>(edges);
        if (edgesVec.size() == 0) {
            return ShapeResult { TopoDS_Shape(), false, "No edges provided" };
        }
        BRepBuilderAPI_MakeWire wire;
        if (edgesVec.size() == 1) {
            wire.Add(edgesVec[0]);
        } else {
            orderEdge(wire, edgesVec);
        }

        if (!wire.IsDone()) {
            return ShapeResult { TopoDS_Shape(), false, "Failed to create wire" };
        }
        return ShapeResult { wire.Wire(), true, "" };
    }

    static ShapeResult face(const WireArray& wires)
    {
        std::vector<TopoDS_Wire> wiresVec = vecFromJSArray<TopoDS_Wire>(wires);
        BRepBuilderAPI_MakeFace makeFace(wiresVec[0]);
        for (int i = 1; i < wiresVec.size(); i++) {
            makeFace.Add(wiresVec[i]);
        }
        if (!makeFace.IsDone()) {
            return ShapeResult { TopoDS_Shape(), false, "Failed to create face" };
        }

        ShapeFix_Face faceFix(makeFace.Face());
        faceFix.FixOrientation();
        faceFix.Perform();

        return ShapeResult { faceFix.Face(), true, "" };
    }

    static ShapeResult faceFromSurface(const WireArray& wires, const TopoDS_Face& sourceFace)
    {
        std::vector<TopoDS_Wire> wiresVec = vecFromJSArray<TopoDS_Wire>(wires);
        Handle(Geom_Surface) surface = BRep_Tool::Surface(sourceFace);
        for (auto& w : wiresVec) {
            ShapeFix_Wire sfw(w, sourceFace, Precision::Confusion());
            sfw.FixReorder();
            sfw.FixConnected();
            sfw.Perform();
            w = sfw.Wire();
        }

        BRepBuilderAPI_MakeFace makeFace(surface, wiresVec[0]);
        for (int i = 1; i < wiresVec.size(); i++) {
            makeFace.Add(wiresVec[i]);
        }
        if (!makeFace.IsDone()) {
            return ShapeResult { TopoDS_Shape(), false, "Failed to create face from surface" };
        }

        TopoDS_Face result = makeFace.Face();

        // Rebuild pcurves on the new face — missing pcurves cause mesh defects.
        BRepLib::BuildCurves3d(result, Precision::Confusion());

        ShapeFix_Face faceFix(result);
        faceFix.FixOrientation();
        faceFix.Perform();

        return ShapeResult { faceFix.Face(), true, "" };
    }

    static ShapeResult shell(const FaceArray& faces)
    {
        std::vector<TopoDS_Face> facesVec = vecFromJSArray<TopoDS_Face>(faces);

        TopoDS_Shell shell;
        BRep_Builder shellBuilder;
        shellBuilder.MakeShell(shell);
        for (const auto& face : facesVec) {
            shellBuilder.Add(shell, face);
        }

        return ShapeResult { shell, true, "" };
    }

    static ShapeResult solid(const ShellArray& shells)
    {
        std::vector<TopoDS_Shell> shellsVec = vecFromJSArray<TopoDS_Shell>(shells);

        BRepBuilderAPI_MakeSolid makeSolid;
        for (auto shell : shellsVec) {
            makeSolid.Add(shell);
        }
        if (!makeSolid.IsDone()) {
            return ShapeResult { TopoDS_Shape(), false, "Failed to create solid" };
        }
        return ShapeResult { makeSolid.Solid(), true, "" };
    }

    static ShapeResult makeThickSolidBySimple(const TopoDS_Shape& shape, double thickness)
    {
        BRepOffsetAPI_MakeThickSolid makeThickSolid;
        makeThickSolid.MakeThickSolidBySimple(shape, thickness);
        if (!makeThickSolid.IsDone()) {
            return ShapeResult { TopoDS_Shape(), false, "Failed to create thick solid" };
        }
        return ShapeResult { makeThickSolid.Shape(), true, "" };
    }

    static ShapeResult makeThickSolidByJoin(const TopoDS_Shape& shape, const ShapeArray& shapes, double thickness, const GeomAbs_JoinType& joinType)
    {
        auto shapesList = shapeArrayToListOfShape(shapes);

        BRepOffsetAPI_MakeThickSolid makeThickSolid;
        makeThickSolid.MakeThickSolidByJoin(shape, shapesList, thickness, 1e-6, BRepOffset_Skin, false, false, joinType);
        if (!makeThickSolid.IsDone()) {
            return ShapeResult { TopoDS_Shape(), false, "Failed to create thick solid" };
        }
        return ShapeResult { makeThickSolid.Shape(), true, "" };
    }

    static ShapeResult simplifyShape(
        const TopoDS_Shape& shape,
        const bool theUnifyEdges,
        const bool theUnifyFaces,
        const ShapeArray& keepShapes,
        double linearTolerance,
        double angularTolerance)
    {
        auto keepShapesList = shapeArrayToMapOfShape(keepShapes);

        ShapeUpgrade_UnifySameDomain anUnifier(shape, theUnifyEdges, theUnifyFaces, true);
        anUnifier.SetLinearTolerance(linearTolerance);
        anUnifier.SetAngularTolerance(angularTolerance);
        anUnifier.KeepShapes(keepShapesList);
        anUnifier.Build();

        return ShapeResult { anUnifier.Shape(), true, "" };
    }

    static ShapeResult booleanOperate(BRepAlgoAPI_BooleanOperation& boolOperater, const ShapeArray& args,
        const ShapeArray& tools)
    {
        auto argsList = shapeArrayToListOfShape(args);
        auto toolsList = shapeArrayToListOfShape(tools);

        boolOperater.SetToFillHistory(false);
        boolOperater.SetArguments(argsList);
        boolOperater.SetTools(toolsList);
        boolOperater.SetFuzzyValue(1e-6);
        boolOperater.Build();
        if (!boolOperater.IsDone()) {
            return ShapeResult { TopoDS_Shape(), false, "Failed to build boolean operation" };
        }

        return ShapeResult { boolOperater.Shape(), true, "" };
    }

    static ShapeResult booleanCommon(const ShapeArray& args, const ShapeArray& tools)
    {
        BRepAlgoAPI_Common api;
        return booleanOperate(api, args, tools);
    }

    static ShapeResult booleanCut(const ShapeArray& args, const ShapeArray& tools)
    {
        BRepAlgoAPI_Cut api;
        return booleanOperate(api, args, tools);
    }

    static ShapeResult booleanFuse(const ShapeArray& args, const ShapeArray& tools)
    {
        BRepAlgoAPI_Fuse api;
        return booleanOperate(api, args, tools);
    }

    static ShapeResult combine(const ShapeArray& shapes)
    {
        std::vector<TopoDS_Shape> shapesVec = vecFromJSArray<TopoDS_Shape>(shapes);
        TopoDS_Compound compound;
        BRep_Builder builder;
        builder.MakeCompound(compound);
        for (auto shape : shapesVec) {
            builder.Add(compound, shape);
        }
        return ShapeResult { compound, true, "" };
    }

    static ShapeResult fillet(const TopoDS_Shape& shape, const NumberArray& edges, double radius)
    {
        std::vector<int> edgeVec = vecFromJSArray<int>(edges);

        NCollection_IndexedMap<TopoDS_Shape, TopTools_ShapeMapHasher> edgeMap;
        TopExp::MapShapes(shape, TopAbs_EDGE, edgeMap);

        BRepFilletAPI_MakeFillet makeFillet(shape);
        for (auto edge : edgeVec) {
            makeFillet.Add(radius, TopoDS::Edge(edgeMap.FindKey(edge + 1)));
        }
        makeFillet.Build();
        if (!makeFillet.IsDone()) {
            return ShapeResult { TopoDS_Shape(), false, "Failed to fillet" };
        }

        return ShapeResult { makeFillet.Shape(), true, "" };
    }

    static ShapeResult chamfer(const TopoDS_Shape& shape, const NumberArray& edges, double distance)
    {
        std::vector<int> edgeVec = vecFromJSArray<int>(edges);

        NCollection_IndexedMap<TopoDS_Shape, TopTools_ShapeMapHasher> edgeMap;
        TopExp::MapShapes(shape, TopAbs_EDGE, edgeMap);

        BRepFilletAPI_MakeChamfer makeChamfer(shape);
        for (auto edge : edgeVec) {
            makeChamfer.Add(distance, TopoDS::Edge(edgeMap.FindKey(edge + 1)));
        }
        makeChamfer.Build();
        if (!makeChamfer.IsDone()) {
            return ShapeResult { TopoDS_Shape(), false, "Failed to chamfer" };
        }
        return ShapeResult { makeChamfer.Shape(), true, "" };
    }

    static ShapeResult fillet2d(const TopoDS_Face& face, const TopoDS_Edge& edge1, const TopoDS_Edge& edge2, double radius)
    {
        TopoDS_Vertex commonVertex = findCommonVertex(edge1, edge2);
        if (commonVertex.IsNull()) {
            return ShapeResult { TopoDS_Shape(), false, "Edges must share a common vertex" };
        }

        ChFi2d_Builder builder(face);
        builder.AddFillet(commonVertex, radius);
        if (builder.Status() != ChFi2d_IsDone) {
            return ShapeResult { TopoDS_Shape(), false, "Failed to create 2D fillet" };
        }

        return ShapeResult { builder.Result(), true, "" };
    }

    static ShapesResult filletEdge2d(const TopoDS_Edge& edge1, const TopoDS_Edge& edge2, double radius)
    {
        std::string error;
        auto corner = computeCornerPlane(edge1, edge2, error);
        if (!corner.has_value()) {
            return ShapesResult { ShapeArray(val::array()), false, error };
        }

        double f1, l1, f2, l2;
        Handle(Geom_Curve) c1 = basisCurve(edge1, f1, l1);
        Handle(Geom_Curve) c2 = basisCurve(edge2, f2, l2);
        TopoDS_Edge e1 = edgeThroughCorner(c1, f1, l1, corner->param1);
        TopoDS_Edge e2 = edgeThroughCorner(c2, f2, l2, corner->param2);

        gp_Pln plane(corner->point, corner->normal);
        ChFi2d_FilletAPI fillet(e1, e2, plane);
        if (!fillet.Perform(radius)) {
            return ShapesResult { ShapeArray(val::array()), false, "Failed to create 2D fillet" };
        }
        TopoDS_Edge newE1, newE2;
        TopoDS_Edge filletEdge = fillet.Result(corner->point, newE1, newE2);
        if (filletEdge.IsNull()) {
            return ShapesResult { ShapeArray(val::array()), false, "Failed to get fillet result" };
        }

        gp_Pnt arcStart, arcEnd;
        edgeEndPoints(filletEdge, arcStart, arcEnd);
        newE1 = edgeToFarEnd(c1, f1, l1, corner->param1, arcStart, arcEnd);
        newE2 = edgeToFarEnd(c2, f2, l2, corner->param2, arcStart, arcEnd);

        return ShapesResult { ShapeArray(buildEdgeTriple(newE1, filletEdge, newE2)), true, "" };
    }

    static ShapeResult chamfer2d(const TopoDS_Face& face, const TopoDS_Edge& edge1, const TopoDS_Edge& edge2, double distance)
    {
        ChFi2d_Builder builder(face);
        builder.AddChamfer(edge1, edge2, distance, distance);
        if (builder.Status() != ChFi2d_IsDone) {
            return ShapeResult { TopoDS_Shape(), false, "Failed to create 2D chamfer" };
        }

        return ShapeResult { builder.Result(), true, "" };
    }

    static ShapesResult chamferEdge2d(const TopoDS_Edge& edge1, const TopoDS_Edge& edge2, double distance)
    {
        std::string error;
        auto corner = computeCornerPlane(edge1, edge2, error);
        if (!corner.has_value()) {
            return ShapesResult { ShapeArray(val::array()), false, error };
        }

        double f1, l1, f2, l2;
        Handle(Geom_Curve) c1 = basisCurve(edge1, f1, l1);
        Handle(Geom_Curve) c2 = basisCurve(edge2, f2, l2);

        // for a line the parameter measures arc length, so the cut is at corner +/- distance
        double p1 = GeomAPI_ProjectPointOnCurve(corner->point, c1).LowerDistanceParameter();
        double p2 = GeomAPI_ProjectPointOnCurve(corner->point, c2).LowerDistanceParameter();

        // keep the side of the corner that contains the edge midpoint
        double cut1 = p1 + ((f1 + l1) / 2 > p1 ? distance : -distance);
        double cut2 = p2 + ((f2 + l2) / 2 > p2 ? distance : -distance);
        double end1 = cut1 > p1 ? l1 : f1;
        double end2 = cut2 > p2 ? l2 : f2;

        TopoDS_Edge newE1 = BRepBuilderAPI_MakeEdge(c1, std::min(cut1, end1), std::max(cut1, end1)).Edge();
        TopoDS_Edge newE2 = BRepBuilderAPI_MakeEdge(c2, std::min(cut2, end2), std::max(cut2, end2)).Edge();
        TopoDS_Edge chamferEdge = BRepBuilderAPI_MakeEdge(c1->Value(cut1), c2->Value(cut2)).Edge();

        return ShapesResult { ShapeArray(buildEdgeTriple(newE1, chamferEdge, newE2)), true, "" };
    }

    static ShapeResult loft(const ShapeArray& sections, bool isSolid, bool isRuled, GeomAbs_Shape continuity)
    {
        std::vector<TopoDS_Shape> shapeVector = emscripten::vecFromJSArray<TopoDS_Shape>(sections);
        if (shapeVector.size() < 2) {
            return ShapeResult { TopoDS_Shape(), false, "Failed to loft: at least 2 sections are required" };
        }
        if (shapeVector.size() == 2 && shapeVector[0].ShapeType() == TopAbs_VERTEX && shapeVector[1].ShapeType() == TopAbs_VERTEX) {
            return ShapeResult { TopoDS_Shape(), false, "Failed to loft: must have at least 1 wires" };
        }

        BRepOffsetAPI_ThruSections loftBuilder(isSolid, isRuled);
        if (!isRuled) {
            loftBuilder.SetContinuity(continuity);
        }

        for (auto& profile : shapeVector) {
            if (profile.ShapeType() == TopAbs_WIRE) {
                loftBuilder.AddWire(TopoDS::Wire(profile));
            } else if (profile.ShapeType() == TopAbs_VERTEX) {
                loftBuilder.AddVertex(TopoDS::Vertex(profile));
            }
        }
        loftBuilder.Build();
        if (!loftBuilder.IsDone()) {
            return ShapeResult { TopoDS_Shape(), false, "Failed to loft" };
        }
        return ShapeResult { loftBuilder.Shape(), true, "" };
    }

    static ShapeResult curveProjection(const TopoDS_Shape& curve, const TopoDS_Shape& targetFace, const gp_Dir& dir)
    {
        BRepProj_Projection curveProjection(curve, targetFace, dir);
        if (!curveProjection.IsDone()) {
            return ShapeResult { TopoDS_Shape(), false, "Failed to create curve projection" };
        }
        return ShapeResult { curveProjection.Shape(), true, "" };
    }

    static ShapeResult fixShape(const TopoDS_Shape& shape, double tolerance)
    {
        ShapeFix_Shape fixer(shape);
        fixer.SetPrecision(tolerance);
        fixer.Perform();
        return ShapeResult { fixer.Shape(), true, "" };
    }

    static ShapeResult fixSmallFace(const TopoDS_Shape& shape, double tolerance)
    {
        ShapeFix_FixSmallFace fixer;
        fixer.Init(shape);
        fixer.SetPrecision(tolerance);
        fixer.Perform();
        return ShapeResult { fixer.Shape(), true, "" };
    }

    static ShapeResult fixWire(const TopoDS_Wire& wire, double tolerance)
    {
    }

    static ShapeResult fixSolid(const TopoDS_Shape& shape, double tolerance)
    {
        ShapeFix_Solid fixer;
        fixer.Init(TopoDS::Solid(shape));
        fixer.SetPrecision(tolerance);
        fixer.Perform();
        return ShapeResult { fixer.Shape(), true, "" };
    }

    static bool hasOnlyOneSub(const TopoDS_Shape& shape, TopAbs_ShapeEnum shapeType)
    {
        size_t size = 0;
        TopExp_Explorer explorer;
        for (explorer.Init(shape, shapeType); explorer.More(); explorer.Next()) {
            size += 1;
            if (size > 1) {
                return false;
            }
        }
        return size == 1;
    }

    static TopoDS_Compound shapeWires(const TopoDS_Shape& shape)
    {
        BRep_Builder builder;
        TopoDS_Compound compound;
        builder.MakeCompound(compound);

        TopExp_Explorer explorer;
        for (explorer.Init(shape, TopAbs_WIRE); explorer.More(); explorer.Next()) {
            builder.Add(compound, TopoDS::Wire(explorer.Current()));
        }

        return compound;
    }

    static ShapeResult removeFeature(const TopoDS_Shape& shape, const ShapeArray& faces)
    {
        std::vector<TopoDS_Shape> facesVector = vecFromJSArray<TopoDS_Shape>(faces);
        BRepAlgoAPI_Defeaturing defea;
        defea.SetShape(shape);
        for (auto& face : facesVector) {
            defea.AddFaceToRemove(face);
        }
        defea.SetRunParallel(true);
        defea.Build();
        if (!defea.IsDone()) {
            return ShapeResult { TopoDS_Shape(), false, "Failed to remove feature" };
        }
        return ShapeResult { defea.Shape(), true, "" };
    }

    static RemoveFilletResult removeFillet(const TopoDS_Shape& shape, const ShapeArray& faces)
    {
        std::vector<TopoDS_Shape> facesVector = vecFromJSArray<TopoDS_Shape>(faces);
        BRepAlgoAPI_Defeaturing defea;
        defea.SetShape(shape);
        for (auto& face : facesVector) {
            defea.AddFaceToRemove(face);
        }
        defea.SetRunParallel(true);
        defea.Build();
        if (!defea.IsDone()) {
            return RemoveFilletResult { TopoDS_Shape(), false, "Failed to remove fillet", ShapeArray(val::array()) };
        }

        val newEdges = val::array();
        TopExp_Explorer explorer;
        for (explorer.Init(shape, TopAbs_FACE); explorer.More(); explorer.Next()) {
            auto face = TopoDS::Face(explorer.Current());
            auto list = defea.Generated(face);
            for (auto& s : list) {
                newEdges.call<void>("push", s);
            }
        }
        return RemoveFilletResult { defea.Shape(), true, "", ShapeArray(newEdges) };
    }

    static ShapeResult removeSubShape(const TopoDS_Shape& shape, const ShapeArray& subShapes)
    {
        std::vector<TopoDS_Shape> subShapesVector = vecFromJSArray<TopoDS_Shape>(subShapes);

        auto source = hasOnlyOneSub(shape, TopAbs_FACE) ? shapeWires(shape) : shape;
        NCollection_IndexedDataMap<TopoDS_Shape, NCollection_List<TopoDS_Shape>, TopTools_ShapeMapHasher> mapEF;
        TopExp::MapShapesAndAncestors(source, TopAbs_EDGE, TopAbs_FACE, mapEF);
        BRepTools_ReShape reShape;
        for (auto& subShape : subShapesVector) {
            reShape.Remove(subShape);

            NCollection_List<TopoDS_Shape> faces;
            if (mapEF.FindFromKey(subShape, faces)) {
                for (auto& face : faces) {
                    reShape.Remove(face);
                }
            }
        }

        return ShapeResult { reShape.Apply(source), true, "" };
    }

    static ShapeResult replaceSubShapes(const TopoDS_Shape& shape,
        const ShapeArray& oldShapes, const ShapeArray& newShapes)
    {
        NCollection_Sequence<TopoDS_Shape> oldSeq = shapeArrayToSequenceOfShape(oldShapes);
        NCollection_Sequence<TopoDS_Shape> newSeq = shapeArrayToSequenceOfShape(newShapes);

        BRepTools_ReShape reShape;
        for (int i = 1; i <= oldSeq.Length() && i <= newSeq.Length(); i++) {
            reShape.Replace(oldSeq.Value(i), newSeq.Value(i));
        }

        return ShapeResult { reShape.Apply(shape), true, "" };
    }

    static ShapeResult sewing(const ShapeArray& shapes)
    {
        std::vector<TopoDS_Shape> shapeVector = emscripten::vecFromJSArray<TopoDS_Shape>(shapes);

        BRepBuilderAPI_Sewing sewing;
        for (auto& shape : shapeVector) {
            sewing.Add(shape);
        }
        sewing.Perform();

        TopoDS_Shape result = sewing.SewedShape();
        if (result.ShapeType() == TopAbs_SHELL) {
            BRepCheck_Analyzer analyzer(result);
            if (analyzer.IsValid()) {
                BRepBuilderAPI_MakeSolid mkSolid(TopoDS::Shell(result));
                if (mkSolid.IsDone())
                    result = mkSolid.Solid();
            }
        }

        return ShapeResult { result, true, "" };
    }
};

EMSCRIPTEN_BINDINGS(ShapeFactory)
{
    class_<ShapeResult>("ShapeResult")
        .property("shape", &ShapeResult::shape, return_value_policy::reference())
        .property("isOk", &ShapeResult::isOk)
        .property("error", &ShapeResult::error);

    class_<RemoveFilletResult>("RemoveFilletResult")
        .property("shape", &RemoveFilletResult::shape, return_value_policy::reference())
        .property("isOk", &RemoveFilletResult::isOk)
        .property("error", &RemoveFilletResult::error)
        .property("newEdges", &RemoveFilletResult::newEdges);

    class_<ShapesResult>("ShapesResult")
        .property("shapes", &ShapesResult::shapes)
        .property("isOk", &ShapesResult::isOk)
        .property("error", &ShapesResult::error);

    class_<ShapeFactory>("ShapeFactory")
        .class_function("box", &ShapeFactory::box)
        .class_function("cone", &ShapeFactory::cone)
        .class_function("sphere", &ShapeFactory::sphere)
        .class_function("ellipsoid", &ShapeFactory::ellipsoid)
        .class_function("ellipse", &ShapeFactory::ellipse)
        .class_function("cylinder", &ShapeFactory::cylinder)
        .class_function("pyramid", &ShapeFactory::pyramid)
        .class_function("sweep", &ShapeFactory::sweep)
        .class_function("revolve", &ShapeFactory::revolve)
        .class_function("prism", &ShapeFactory::prism)
        .class_function("pushPull", &ShapeFactory::pushPull)
        .class_function("polygon", &ShapeFactory::polygon)
        .class_function("circle", &ShapeFactory::circle)
        .class_function("arc", &ShapeFactory::arc)
        .class_function("bezier", &ShapeFactory::bezier)
        .class_function("rect", &ShapeFactory::rect)
        .class_function("point", &ShapeFactory::point)
        .class_function("line", &ShapeFactory::line)
        .class_function("wire", &ShapeFactory::wire)
        .class_function("face", &ShapeFactory::face)
        .class_function("faceFromSurface", &ShapeFactory::faceFromSurface)
        .class_function("shell", &ShapeFactory::shell)
        .class_function("solid", &ShapeFactory::solid)
        .class_function("makeThickSolidBySimple", &ShapeFactory::makeThickSolidBySimple)
        .class_function("makeThickSolidByJoin", &ShapeFactory::makeThickSolidByJoin)
        .class_function("simplifyShape", &ShapeFactory::simplifyShape)
        .class_function("booleanCommon", &ShapeFactory::booleanCommon)
        .class_function("booleanCut", &ShapeFactory::booleanCut)
        .class_function("booleanFuse", &ShapeFactory::booleanFuse)
        .class_function("combine", &ShapeFactory::combine)
        .class_function("fillet", &ShapeFactory::fillet)
        .class_function("chamfer", &ShapeFactory::chamfer)
        .class_function("fillet2d", &ShapeFactory::fillet2d)
        .class_function("chamfer2d", &ShapeFactory::chamfer2d)
        .class_function("filletEdge2d", &ShapeFactory::filletEdge2d)
        .class_function("chamferEdge2d", &ShapeFactory::chamferEdge2d)
        .class_function("fixShape", &ShapeFactory::fixShape)
        .class_function("fixSmallFace", &ShapeFactory::fixSmallFace)
        .class_function("fixSolid", &ShapeFactory::fixSolid)
        .class_function("loft", &ShapeFactory::loft)
        .class_function("curveProjection", &ShapeFactory::curveProjection)
        .class_function("removeFeature", &ShapeFactory::removeFeature)
        .class_function("removeFillet", &ShapeFactory::removeFillet)
        .class_function("removeSubShape", &ShapeFactory::removeSubShape)
        .class_function("replaceSubShapes", &ShapeFactory::replaceSubShapes)
        .class_function("sewing", &ShapeFactory::sewing);
}