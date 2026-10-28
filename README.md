# GLMaze

[![Travis-CI Status](https://travis-ci.org/ultitech/GLMaze.svg?branch=master)](https://travis-ci.org/ultitech/GLMaze)
[![AppVeyor Status](https://ci.appveyor.com/api/projects/status/g9hi0c28c5ndv6a2?svg=true)](https://ci.appveyor.com/project/ultitech/glmaze)
[![Release](https://img.shields.io/badge/release-v1.0-blue.svg)](https://github.com/ultitech/GLMaze/releases/latest)
[![License: zlib](https://img.shields.io/badge/license-zlib-blue.svg)](http://www.zlib.net/zlib_license.html)

GLMaze is a cross-platform clone of the classic Windows 95 3D maze screensaver.

Planning a browser-native reconstruction? See the
[Windows 95 Maze — Browser Reconstruction checklist](TODO.md).

## Browser reconstruction

**Live page:** https://cheerupemonerdemoji.github.io/windows-95-maze-browser/ (GitHub Pages; the page needs WebGL 2 for the
first-person view and falls back to a top-down debug map without it).

The `web` folder contains a dependency-free (static ES modules, WebGL 2, no bundler) browser reconstruction of the Windows 95 Maze
behaviour, built from the recovered generator, route and camera rules rather than from Microsoft's code or artwork. It is a **first
playable preview and not a claim of complete parity**: the textures, Start sign and smiley are original procedural stand-ins and
several details are still unknown (listed in [the parity matrix](docs/parity-matrix.md) and
[the analysis dossier](docs/original-exit-camera-analysis.md)).

* 12×12 randomized-Kruskal maze, Microsoft-compatible random stream with a 10-value warm-up (selectable; a portable stream remains
  as a debug mode), random entrance and exit rows, and the recovered left- or right-hand route rule. The same seed gives the same run.
* Recovered camera and world: cubic cells, 90° vertical field of view at aspect 1.0, the camera on the midpoint of the edge it
  entered a cell by, 18-update moves and turns on a fixed 25 ms step (450 ms nominal), walls that grow and shrink at the entrance
  and exit, and a new maze after every exit without reloading.
* Trigger solids with the recovered 18-update scene roll, experimental flags for marker artwork, picture walls, logo objects and a
  rat, a Turbo 320×200 look, reduced motion, fullscreen, and a JSON/NDJSON evidence export.
* An **Appearance** tab with three texture themes: **Classic** (the faithful default), an optional **Backrooms-inspired** theme (three
  original images generated for this project, loaded only when chosen) and **Custom**, where you pick your own wall, floor and ceiling
  images (PNG, JPEG or WebP, up to 10 MB and 4096 px). Your images stay in your browser and are never uploaded; "Clear stored images"
  deletes the copy kept for next time. Themes are presentation only and add no Microsoft Maze evidence; custom pictures show seams
  unless they are seamless squares. `?theme=classic|backrooms|custom` selects a theme from the URL.

With Node.js 20 or newer installed (there is nothing to install):

```powershell
npm test                # unit tests
npm start               # http://127.0.0.1:8080
npm run build           # static artifact in dist/site, validated (this is the whole "production build")
npm run smoke           # Chrome or Edge behaviour checks (dev tool; set CHROME_PATH if needed)
npm run visual          # fixed-seed screenshot comparison
npm run smoke:mobile    # phone-sized viewport emulation (not a physical-phone test)
npm run smoke:appearance # Appearance tab: themes, custom uploads, privacy, leaks, context loss (Chrome or Edge)
npm run smoke:firefox   # Firefox checks over WebDriver BiDi (local only)
npm run telemetry -- --seed 2017 --updates 3000   # deterministic per-update evidence export
```

Settings and seeds live in the URL and the browser's local storage; nothing is collected. See
[the release checklist](docs/release-checklist.md), [the release notes](docs/release-notes.md),
[browser maze generation and navigation](docs/browser-maze-generation.md) and [the phone acceptance page](docs/phone-acceptance.md).
The browser work follows the root zlib-style licence terms; the copyright-holder name for it is still to be chosen
([licence proposal](docs/license-proposal.md)). GLMaze's native game, below, is unchanged by this work.

Be mesmerized as you walk through the seemingly endless maze, trying to find the exit. Pass a pyramid to turn your world upside down, but watch out for the puddles of water on the ground. You can even enter night vision to make you feel like a real spy.

![Screenshot with Nightvision](https://images.ulti.tech/glmaze/glmaze_github1.jpg)
![Screenshot](https://images.ulti.tech/glmaze/glmaze_github2.jpg)
![Screenshot with Nightvision and Motion Blur](https://images.ulti.tech/glmaze/glmaze_github3.jpg)

## Getting Started

This project was created as a graphic demo to test the OpenGL 2.0 pipeline using SDL2 on Linux, Mac, and Windows. We included several shaders, such as motion blur, night vision as well as a 3D side-by-side mode.

The latest binary releases can be found [here](https://github.com/ultitech/GLMaze/releases/latest) or you can build the project yourself.

### Prerequisites

GLMaze requires [cmake](http://cmake.org) for compilation and depends on several third-party open source libraries:

+ [SDL2](https://www.libsdl.org)
+ [GLEW](http://glew.sourceforge.net)
+ [FreeImage](http://freeimage.sourceforge.net)

#### Linux

+ build-essential

#### Mac

+ [Xcode](https://itunes.apple.com/us/app/xcode/id497799835?mt=12)
+ ([Sparkle](https://sparkle-project.org) - optional)

#### Windows

+ [Visual Studio](https://www.visualstudio.com/en-us/products/visual-studio-express-vs.aspx) or
+ [MinGW](http://www.mingw.org)

### Compiling

#### Linux

If you haven't already, install the build-essentials and cmake, e.g.
```Bash
sudo apt-get install build-essential cmake
```

Install all required libraries using your preferred package manager, e.g.
```Bash
sudo apt-get install libsdl2-dev libfreeimage-dev libglew-dev
```

Next create your build directory inside the GLMaze folder and run `cmake ..`, e.g.
```Bash
mkdir build && cd build && cmake ..
```

Finally run `make` to compile the project.

#### Mac

If you haven't already, install Xcode and cmake.

Download the latest [SDL2 Development Library](https://www.libsdl.org/download-2.0.php) and copy the `SDL2.framework` framework into `/Library/Frameworks`.

Use [homebrew](http://brew.sh) to install the rest of the libraries, e.g.
```Bash
brew install freeimage glew
```

Next create your build directory inside the GLMaze folder and run `cmake ..`. This creates a UNIX Makefile; to create a Xcode project file instead, use `cmake -G "Xcode" ..`, e.g.
```Bash
mkdir build && cd build && cmake -G "Xcode" ..
```

Finally run `make` or open up the Xcode project, select the GLMaze target, and hit run.


#### Windows

##### Visual Studio
If you haven't already, install Visual Studio and cmake.

Download the latest libraries, place them in your preferred location, and set their path as environment variables (SDL2, FREEIMAGE, GLEW).

Next create your build directory inside the GLMaze folder and run `cmake ..`. To [specify](https://cmake.org/cmake/help/v3.0/manual/cmake-generators.7.html#ide-build-tool-generators) the Visual Studio version and build architecture use `cmake -G "Visual Studio ` followed by version, year, and architecture, e.g. `12 2013 Win64" ..`.

Finally open up the GLMaze solution and hit build.

### Configuration

You can change the resolution and turn on fullscreen using the [config.txt](res/config.txt) file. To load your own Shaders, place the files in the Shader subdirectory and add them to `pp_pipeline` separated by `;` like so `Filename;Hotkey`.

## Authors

Copyright © 2018 by [ultitech](https://www.ulti.tech)

* **Lukas Feller** - *Lead Programmer* - [luckyxxl](https://github.com/luckyxxl)
* **David Greiner** - *Programmer* - [davidgreiner](https://github.com/davidgreiner)

## License

This project is licensed under the zlib License - see the [LICENSE.txt](LICENSE.txt) file for details.

## Acknowledgments

Thanks to Microsoft for allowing us to spend countless hours being mesmerized by a screensaver when we were kids.
