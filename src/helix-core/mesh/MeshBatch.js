import {Mesh} from "./Mesh";

/**
 * MeshBatch is a util that creates a number copies of the same mesh with hx_instanceID being the instance number of the copy.
 *
 * @author derschmale <http://www.derschmale.com>
 */
var MeshBatch =
    {
        create: function (sourceMesh, numInstances)
        {
            var len, i, j;
            var target = new Mesh();
            var sourceIndices = sourceMesh._indexData;

            target._vertexUsage = sourceMesh._vertexUsage;
            target._indexUsage = sourceMesh._indexUsage;

            var attribs = sourceMesh._vertexAttributes;
            var instanceStream = sourceMesh.numStreams;

            for (i = 0; i < attribs.length; ++i) {
                var attribute = attribs[i];
                target.addVertexAttribute(attribute.name, attribute.numComponents, attribute.streamIndex);
            }

            target.addVertexAttribute("hx_instanceID", 1, instanceStream);

            var targetIndices = [];
            var index = 0;
            var numVertices = sourceMesh.numVertices;

            len = sourceIndices.length;

            for (i = 0; i < numInstances; ++i) {
                for (j = 0; j < len; ++j) {
                    targetIndices[index++] = sourceIndices[j] + numVertices * i;
                }
            }

            target.setIndexData(targetIndices);

            for (i = 0; i < sourceMesh.numStreams; ++i) {
                var targetVertices = [];
                var sourceVertices = sourceMesh.getVertexData(i);

                len = sourceVertices.length;
                index = 0;

                // duplicate vertex data for each instance
                for (j = 0; j < numInstances; ++j) {
                    for (var k = 0; k < len; ++k) {
                        targetVertices[index++] = sourceVertices[k];
                    }
                }

                target.setVertexData(targetVertices, i);
            }

            var instanceData = [];
            index = 0;
            for (j = 0; j < numInstances; ++j) {
                for (i = 0; i < numVertices; ++i) {
                    instanceData[index++] = j;
                }
            }

            // something actually IS wrong with the instance data
            // drawing an explicit subselection of indices with constant instance index is correct
            // filling the entire array with 0 doesn't help, so it looks like the data is not set correctly
            target.setVertexData(instanceData, instanceStream);

            return target;
        }
    };

export { MeshBatch };