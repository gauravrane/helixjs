import {Shader} from "../shader/Shader";
import {ShaderLibrary} from "../shader/ShaderLibrary";
import {TextureCube} from "../texture/TextureCube";
import {GL} from "../core/GL";
import {FrameBuffer} from "../texture/FrameBuffer";
import {capabilities, TextureFilter} from "../Helix";
import {VertexBuffer} from "../core/VertexBuffer";
import {IndexBuffer} from "../core/IndexBuffer";

/**
 * EquirectangularTexture is a utility class that converts equirectangular environment {@linknode Texture2D} to a
 * {@linkcode TextureCube}.
 * @author derschmale <http://www.derschmale.com>
 */
export var EquirectangularTexture =
{
    /**
     * Convert an equirectangular environment {@linknode Texture2D} to a {@linkcode TextureCube}.
     * @param source The source {@linknode Texture2D}
     * @param [size] The size of the target cube map.
     * @param [generateMipmaps] Whether or not a mip chain should be generated.
     * @param [target] An optional target {@linkcode TextureCube} to contain the converted data.
     * @returns {TextureCube} The environment map in a {@linkcode TextureCube}
     */
    toCube: function(source, size, generateMipmaps, target)
    {
        generateMipmaps = generateMipmaps || true;
        size = size || source.height;

        if (!EquirectangularTexture._EQUI_TO_CUBE_SHADER)
            EquirectangularTexture._EQUI_TO_CUBE_SHADER = new Shader(ShaderLibrary.get("2d_to_cube_vertex.glsl"), ShaderLibrary.get("equirectangular_to_cube_fragment.glsl"));

        this._createRenderCubeGeometry();

        var gl = GL.gl;
        target = target || new TextureCube();
        target.initEmpty(size, source.format, source.dataType);
        var faces = [ gl.TEXTURE_CUBE_MAP_POSITIVE_X, gl.TEXTURE_CUBE_MAP_NEGATIVE_X, gl.TEXTURE_CUBE_MAP_POSITIVE_Y, gl.TEXTURE_CUBE_MAP_NEGATIVE_Y, gl.TEXTURE_CUBE_MAP_POSITIVE_Z, gl.TEXTURE_CUBE_MAP_NEGATIVE_Z ];

        EquirectangularTexture._EQUI_TO_CUBE_SHADER.updatePassRenderState();

        var textureLocation = EquirectangularTexture._EQUI_TO_CUBE_SHADER.getUniformLocation("source");
        var posLocation = EquirectangularTexture._EQUI_TO_CUBE_SHADER.getAttributeLocation("hx_position");
        var cornerLocation = EquirectangularTexture._EQUI_TO_CUBE_SHADER.getAttributeLocation("corner");

        gl.uniform1i(textureLocation, 0);
        source.bind(0);

        EquirectangularTexture._TO_CUBE_VERTICES.bind();
        EquirectangularTexture._TO_CUBE_INDICES.bind();
        gl.vertexAttribPointer(posLocation, 2, gl.FLOAT, false, 20, 0);
        gl.vertexAttribPointer(cornerLocation, 3, gl.FLOAT, false, 20, 8);

        GL.enableAttributes(2);
        var old = GL.getCurrentRenderTarget();

        for (var i = 0; i < 6; ++i) {
            var fbo = new FrameBuffer(target, null, faces[i]);
            fbo.init();

            GL.setRenderTarget(fbo);
            GL.drawElements(gl.TRIANGLES, 6, i * 6);
        }

        GL.setRenderTarget(old);

        if (generateMipmaps)
            target.generateMipmap();

        // TODO: for some reason, if EXT_shader_texture_lod is not supported, mipmapping of rendered-to cubemaps does not work
        if (!capabilities.EXT_SHADER_TEXTURE_LOD)
            target.filter = TextureFilter.BILINEAR_NOMIP;

        return target;
    },

    _createRenderCubeGeometry: function()
    {
        if (EquirectangularTexture._TO_CUBE_VERTICES) return;
        var vertices = [
            // pos X
            1.0, 1.0, 1.0, -1.0, -1.0,
            -1.0, 1.0, 1.0, -1.0, 1.0,
            -1.0, -1.0, 1.0, 1.0, 1.0,
            1.0, -1.0, 1.0, 1.0, -1.0,

            // neg X
            1.0, 1.0, -1.0, -1.0, 1.0,
            -1.0, 1.0, -1.0, -1.0, -1.0,
            -1.0, -1.0, -1.0, 1.0, -1.0,
            1.0, -1.0, -1.0, 1.0, 1.0,

            // pos Y
            -1.0, -1.0, -1.0, 1.0, -1.0,
            1.0, -1.0, 1.0, 1.0, -1.0,
            1.0, 1.0, 1.0, 1.0, 1.0,
            -1.0, 1.0, -1.0, 1.0, 1.0,

            // neg Y
            -1.0, -1.0, -1.0, -1.0, 1.0,
            1.0, -1.0, 1.0, -1.0, 1.0,
            1.0, 1.0, 1.0, -1.0, -1.0,
            -1.0, 1.0, -1.0, -1.0, -1.0,

            // pos Z
            1.0, 1.0, 1.0, -1.0, 1.0,
            -1.0, 1.0, -1.0, -1.0, 1.0,
            -1.0, -1.0, -1.0, 1.0, 1.0,
            1.0, -1.0, 1.0, 1.0, 1.0,

            // neg Z
            1.0, 1.0, -1.0, -1.0, -1.0,
            -1.0, 1.0, 1.0, -1.0, -1.0,
            -1.0, -1.0, 1.0, 1.0, -1.0,
            1.0, -1.0, -1.0, 1.0, -1.0
        ];
        var indices = [
            0, 1, 2, 0, 2, 3,
            4, 5, 6, 4, 6, 7,
            8, 9, 10, 8, 10, 11,
            12, 13, 14, 12, 14, 15,
            16, 17, 18, 16, 18, 19,
            20, 21, 22, 20, 22, 23
        ];
        EquirectangularTexture._TO_CUBE_VERTICES = new VertexBuffer();
        EquirectangularTexture._TO_CUBE_INDICES = new IndexBuffer();
        EquirectangularTexture._TO_CUBE_VERTICES.uploadData(new Float32Array(vertices));
        EquirectangularTexture._TO_CUBE_INDICES.uploadData(new Uint16Array(indices));
    }
};