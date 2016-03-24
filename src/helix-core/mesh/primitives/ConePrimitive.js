HX.ConePrimitive = HX.Primitive.define();

/**
 * The alignment dictates which access should be parallel to the sides of the cylinder
 * @type {number}
 */
HX.ConePrimitive.ALIGN_X = 1;
HX.ConePrimitive.ALIGN_Y = 2;
HX.ConePrimitive.ALIGN_Z = 3;

HX.ConePrimitive._generate = function(target, definition)
{
    definition = definition || {};
    var numSegmentsH = definition.numSegmentsH || 1;
    var numSegmentsW = definition.numSegmentsW || 1;
    var radius = definition.radius || 1;
    var height = definition.height || 1;
    var doubleSided = definition.doubleSided === undefined? false : definition.doubleSided;

    var positions = target.positions;
    var uvs = target.uvs;
    var normals = target.normals;
    var indices = target.indices;

    var rcpNumSegmentsW = 1/numSegmentsW;
    var rcpNumSegmentsH = 1/numSegmentsH;

    // sides
    for (var hi = 0; hi <= numSegmentsH; ++hi) {
        var rad = (1.0 - hi * rcpNumSegmentsH) * radius;
        var h = (hi*rcpNumSegmentsH - .5)*height;
        for (var ci = 0; ci <= numSegmentsW; ++ci) {
            var angle = ci * rcpNumSegmentsW * Math.PI * 2;
            var nx = Math.sin(angle);
            var ny = Math.cos(angle);
            var cx = nx * rad;
            var cy = ny * rad;

            positions.push(cx, h, -cy);
            if (normals) normals.push(nx, 0, -ny);

            if (uvs) uvs.push(1.0 - ci*rcpNumSegmentsW, hi*rcpNumSegmentsH);
        }
    }

    for (var ci = 0; ci < numSegmentsW; ++ci) {
        for (var hi = 0; hi < numSegmentsH - 1; ++hi) {
            var w = numSegmentsW + 1;
            var base = ci + hi*w;

            indices.push(base, base + w, base + w + 1);
            indices.push(base, base + w + 1, base + 1);

            if (doubleSided) {
                indices.push(base, base + w + 1, base + w);
                indices.push(base, base + 1, base + w + 1);
            }
        }

        // tip only needs 1 tri
        var w = numSegmentsW + 1;
        var base = ci + (numSegmentsH - 1)*w;
        indices.push(base, base + w + 1, base + 1);
    }

    // top & bottom
    var indexOffset = positions.length / 3;
    var halfH = height * .5;
    for (var ci = 0; ci < numSegmentsW; ++ci) {
        var angle = ci * rcpNumSegmentsW * Math.PI * 2;
        var u = Math.sin(angle);
        var v = Math.cos(angle);
        var cx = u * radius;
        var cy = v * radius;

        u = -u * .5 + .5;
        v = v * .5 + .5;

        positions.push(cx, -halfH, -cy);
        if (normals) normals.push(0, -1, 0);
        if (uvs) uvs.push(u, v);
    }

    for (var ci = 1; ci < numSegmentsW - 1; ++ci)
        indices.push(indexOffset, indexOffset + ci, indexOffset + ci + 1);
};