/**
 *
 * @param mode
 * @param initialDistance
 * @param decayFactor
 * @param maxTests
 * @constructor
 */
HX.PoissonSphere = function(mode, initialDistance, decayFactor, maxTests)
{
    this._mode = mode === undefined? HX.PoissonSphere.CIRCULAR : mode;
    this._initialDistance = initialDistance || 1.0;
    this._decayFactor = decayFactor || .99;
    this._maxTests = maxTests || 20000;
    this._currentDistance = 0;
    this._points = null;
    this.reset();
};

HX.PoissonSphere.BOX = 0;
HX.PoissonSphere.CIRCULAR = 1;

HX.PoissonSphere._initDefault = function()
{
    HX.PoissonSphere.DEFAULT = new HX.PoissonSphere();
    HX.PoissonSphere.DEFAULT.generatePoints(64);
    HX.PoissonSphere.DEFAULT_FLOAT32 = new Float32Array(64 * 3);

    var spherePoints = HX.PoissonSphere.DEFAULT.getPoints();

    for (var i = 0; i < 64; ++i) {
        var p = spherePoints[i];
        HX.PoissonSphere.DEFAULT_FLOAT32[i * 3] = p.x;
        HX.PoissonSphere.DEFAULT_FLOAT32[i * 3 + 1] = p.y;
        HX.PoissonSphere.DEFAULT_FLOAT32[i * 3 + 2] = p.z;
    }
};

HX.PoissonSphere.prototype =
{
    getPoints: function()
    {
        return this._points;
    },

    reset : function()
    {
        this._currentDistance = this._initialDistance;
        this._points = [];
    },

    generatePoints: function(numPoints)
    {
        for (var i = 0; i < numPoints; ++i)
            this.generatePoint();
    },

    generatePoint: function()
    {
        for (;;) {
            var testCount = 0;
            var sqrDistance = this._currentDistance*this._currentDistance;

            while (testCount++ < this._maxTests) {
                var candidate = this._getCandidate();
                if (this._isValid(candidate, sqrDistance)) {
                    this._points.push(candidate);
                    return candidate;
                }
            }
            this._currentDistance *= this._decayFactor;
        }
    },

    _getCandidate: function()
    {
        for (;;) {
            var x = Math.random() * 2.0 - 1.0;
            var y = Math.random() * 2.0 - 1.0;
            var z = Math.random() * 2.0 - 1.0;
            if (this._mode == HX.PoissonSphere.BOX || (x * x + y * y + z * z <= 1))
                return new HX.Float4(x, y, z, 0.0);
        }
    },

    _isValid: function(candidate, sqrDistance)
    {
        var len = this._points.length;
        for (var i = 0; i < len; ++i) {
            var p = this._points[i];
            var dx = candidate.x - p.x;
            var dy = candidate.y - p.y;
            var dz = candidate.z - p.z;
            if (dx*dx + dy*dy + dz*dz < sqrDistance)
                return false;
        }

        return true;
    }
};