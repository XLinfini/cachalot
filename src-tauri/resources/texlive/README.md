# Private TeX Live bundle

Generated with `npm run texlive:prepare`; payloads are ignored. Tauri packages
`runtime.tar.gz`, `manifest.json`, `packages.txt` and `engine-source.tar.gz`. The source specification is
`scripts/texlive-spec.ts`. Build checks verify platform, required packages and SHA-256.

The runtime retains TeX Live's LICENSE.TL, LICENSE.CTAN and individual package
documentation and sources. These contain the applicable licences, notices and
redistribution terms. The engine source archive is the pinned official branch2025
tree, including build scripts and bundled library sources. Keep it alongside the
redistributed engine and package sources. TeX Live is a distribution of independently licensed packages:
https://tug.org/texlive/copying.html . Do not strip these notices when repackaging.

Current payload: Linux x86-64, TeX Live 2025 final. Host prerequisites: bubblewrap,
Perl, standard Linux C/C++/fontconfig libraries. No system TeX installation is needed.
