/**
 *
 * @constructor
 */
HX.Frustum = function()
{
    this._planes = new Array(6);
    this._corners = new Array(8);

    for (var i = 0; i < 6; ++i)
        this._planes[i] = new HX.Float4();

    for (var i = 0; i < 8; ++i)
        this._corners[i] = new HX.Float4();

    this._r1 = new HX.Float4();
    this._r2 = new HX.Float4();
    this._r3 = new HX.Float4();
    this._r4 = new HX.Float4();
};

HX.Frustum.PLANE_LEFT = 0;
HX.Frustum.PLANE_RIGHT = 1;
HX.Frustum.PLANE_BOTTOM = 2;
HX.Frustum.PLANE_TOP = 3;
HX.Frustum.PLANE_NEAR = 4;
HX.Frustum.PLANE_FAR = 5;

HX.Frustum.CLIP_SPACE_CORNERS = [	new HX.Float4(-1.0, -1.0, -1.0, 1.0),
                                    new HX.Float4(1.0, -1.0, -1.0, 1.0),
                                    new HX.Float4(1.0, 1.0, -1.0, 1.0),
                                    new HX.Float4(-1.0, 1.0, -1.0, 1.0),
                                    new HX.Float4(-1.0, -1.0, 1.0, 1.0),
                                    new HX.Float4(1.0, -1.0, 1.0, 1.0),
                                    new HX.Float4(1.0, 1.0, 1.0, 1.0),
                                    new HX.Float4(-1.0, 1.0, 1.0, 1.0)
                                ];

HX.Frustum.prototype =
{
    /**
     * An Array of planes describing frustum. The planes are in world space and point outwards.
     */
    get planes() { return this._planes; },

    /**
     * An array containing the 8 vertices of the frustum, in world space.
     */
    get corners() { return this._corners; },

    update: function(projection, inverseProjection)
    {
        this._updatePlanes(projection);
        this._updateCorners(inverseProjection);
    },

    _updatePlanes: function(projection)
    {
        // todo: this can all be inlined, but not the highest priority (only once per frame)
        var r1 = projection.getRow(0, this._r1);
        var r2 = projection.getRow(1, this._r2);
        var r3 = projection.getRow(2, this._r3);
        var r4 = projection.getRow(3, this._r4);

        HX.Float4.add(r4, r1, this._planes[HX.Frustum.PLANE_LEFT]);
        HX.Float4.subtract(r4, r1, this._planes[HX.Frustum.PLANE_RIGHT]);
        HX.Float4.add(r4, r2, this._planes[HX.Frustum.PLANE_BOTTOM]);
        HX.Float4.subtract(r4, r2, this._planes[HX.Frustum.PLANE_TOP]);
        HX.Float4.add(r4, r3, this._planes[HX.Frustum.PLANE_NEAR]);
        HX.Float4.subtract(r4, r3, this._planes[HX.Frustum.PLANE_FAR]);

        for (var i = 0; i < 6; ++i) {
            this._planes[i].negate();
            this._planes[i].normalizeAsPlane();
        }
    },

    _updateCorners: function(inverseProjection)
    {
        for (var i = 0; i < 8; ++i) {
            var corner = this._corners[i];
            inverseProjection.transform(HX.Frustum.CLIP_SPACE_CORNERS[i], corner);
            corner.scale(1.0 / corner.w);
        }
    }
};

/**
 *
 * @constructor
 */
HX.Camera = function()
{
    HX.Entity.call(this);

    this._renderTargetWidth = 0;
    this._renderTargetHeight = 0;
    this._viewProjectionMatrixInvalid = true;
    this._viewProjectionMatrix = new HX.Matrix4x4();
    this._inverseProjectionMatrix = new HX.Matrix4x4();
    this._inverseViewProjectionMatrix = new HX.Matrix4x4();
    this._projectionMatrix = new HX.Matrix4x4();
    this._viewMatrix = new HX.Matrix4x4();
    this._projectionMatrixDirty = true;
    this._nearDistance = .1;
    this._farDistance = 1000;
    this._frustum = new HX.Frustum();

    this.position.set(0.0, 0.0, 1.0);
};

HX.Camera.prototype = Object.create(HX.Entity.prototype);

Object.defineProperties(HX.Camera.prototype, {
    nearDistance: {
        get: function() {
            return this._nearDistance;
        },

        set: function(value) {
            this._nearDistance = value;
            this._invalidateProjectionMatrix();
        }
    },
    farDistance: {
        get: function() {
            return this._farDistance;
        },

        set: function(value) {
            this._farDistance = value;
            this._invalidateProjectionMatrix();
        }
    },

    viewProjectionMatrix: {
        get: function() {
            if (this._viewProjectionMatrixInvalid)
                this._updateViewProjectionMatrix();

            return this._viewProjectionMatrix;
        }
    },

    viewMatrix: {
        get: function()
        {
            if (this._viewProjectionMatrixInvalid)
                this._updateViewProjectionMatrix();

            return this._viewMatrix;
        }
    },

    projectionMatrix: {
        get: function()
        {
            if (this._projectionMatrixDirty)
                this._updateProjectionMatrix();

            return this._projectionMatrix;
        }
    },

    inverseViewProjectionMatrix: {
        get: function()
        {
            if (this._viewProjectionMatrixInvalid)
                this._updateViewProjectionMatrix();

            return this._inverseViewProjectionMatrix;
        }
    },

    inverseProjectionMatrix: {
        get: function()
        {
            if (this._projectionMatrixDirty)
                this._updateProjectionMatrix();

            return this._inverseProjectionMatrix;
        }
    },

    frustum: {
        get: function()
        {
            if (this._viewProjectionMatrixInvalid)
                this._updateViewProjectionMatrix();

            return this._frustum;
        }
    }
});

HX.Camera.prototype.acceptVisitor = function(visitor)
{
    HX.SceneNode.prototype.acceptVisitor.call(this, visitor);
};

HX.Camera.prototype._setRenderTargetResolution = function(width, height)
{
    this._renderTargetWidth = width;
    this._renderTargetHeight = height;
};

HX.Camera.prototype._invalidateViewProjectionMatrix = function()
{
    this._viewProjectionMatrixInvalid = true;
};

HX.Camera.prototype._invalidateWorldTransformationMatrix = function()
{
    HX.Entity.prototype._invalidateWorldTransformationMatrix.call(this);
    this._invalidateViewProjectionMatrix();
};

HX.Camera.prototype._updateViewProjectionMatrix = function()
{
    this._viewMatrix.inverseAffineOf(this.worldMatrix);
    this._viewProjectionMatrix.multiply(this.projectionMatrix, this._viewMatrix);
    this._inverseProjectionMatrix.inverseOf(this._projectionMatrix);
    this._inverseViewProjectionMatrix.inverseOf(this._viewProjectionMatrix);
    this._frustum.update(this._viewProjectionMatrix, this._inverseViewProjectionMatrix);
    this._viewProjectionMatrixInvalid = false;
};

HX.Camera.prototype._invalidateProjectionMatrix = function()
{
    this._projectionMatrixDirty = true;
    this._invalidateViewProjectionMatrix();
};

HX.Camera.prototype._updateProjectionMatrix = function()
{
    throw new Error("Abstract method!");
};

HX.Camera.prototype._updateWorldBounds = function()
{
    this._worldBounds.clear(HX.BoundingVolume.EXPANSE_INFINITE);
};

HX.Camera.prototype.toString = function()
{
    return "[Camera(name=" + this._name + ")]";
};

/**
 * @constructor
 */
HX.PerspectiveCamera = function ()
{
    HX.Camera.call(this);

    this._vFOV = 1.047198;  // radians!
    this._aspectRatio = 0;
};


HX.PerspectiveCamera.prototype = Object.create(HX.Camera.prototype);

Object.defineProperties(HX.PerspectiveCamera.prototype, {
    verticalFOV: {
        get: function()
        {
            return this._vFOV;
        },
        set: function(value)
        {
            this._vFOV = value;
            this._invalidateProjectionMatrix();
        }
    }
});

HX.PerspectiveCamera.prototype._setAspectRatio = function(value)
{
    if (this._aspectRatio == value) return;

    this._aspectRatio = value;
    this._invalidateProjectionMatrix();
};

HX.PerspectiveCamera.prototype._setRenderTargetResolution = function(width, height)
{
    HX.Camera.prototype._setRenderTargetResolution.call(this, width, height);
    this._setAspectRatio(width / height);
};

HX.PerspectiveCamera.prototype._updateProjectionMatrix = function()
{
    this._projectionMatrix.fromPerspectiveProjection(this._vFOV, this._aspectRatio, this._nearDistance, this._farDistance);
    this._projectionMatrixDirty = false;
};

/**
 * @constructor
 */
HX.OrthographicOffCenterCamera = function ()
{
    HX.Camera.call(this);
    this._left = -1;
    this._right = 1;
    this._top = 1;
    this._bottom = -1;
};

HX.OrthographicOffCenterCamera.prototype = Object.create(HX.Camera.prototype);

HX.OrthographicOffCenterCamera.prototype.setBounds = function(left, right, top, bottom)
{
    this._left = left;
    this._right = right;
    this._top = top;
    this._bottom = bottom;
    this._invalidateProjectionMatrix();
};

HX.OrthographicOffCenterCamera.prototype._updateProjectionMatrix = function()
{
    this._projectionMatrix.fromOrthographicOffCenterProjection(this._left, this._right, this._top, this._bottom, this._nearDistance, this._farDistance);
    this._projectionMatrixDirty = false;
};