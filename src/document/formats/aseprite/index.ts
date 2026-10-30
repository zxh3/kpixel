// Clean-room .aseprite support, written only from Aseprite's published file format spec:
// https://github.com/aseprite/aseprite/blob/main/docs/ase-file-specs.md
// Aseprite's source code is under a proprietary EULA; none of it is used here.

export { asepriteDataNamespace, userPropertiesNamespace } from "./mapping-constants";
export { readAseprite, type AsepriteImportResult } from "./read-aseprite";
export { writeAseprite } from "./write-aseprite";
