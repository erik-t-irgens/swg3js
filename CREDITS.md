# Credits

Work by others the game's code is written from. Nothing here is a game asset; the game's assets are converted on each
player's own machine and are never part of the code (see `README.md`).

## The sky's air (`src/sky/air/`)

The air (the GPU port's pass 2) is Sébastien Hillaire's method, "A Scalable and Production Ready Sky and Atmosphere
Rendering Technique" (Eurographics Symposium on Rendering, 2020), with the transmittance table laid out by Eric
Bruneton's mapping ("Precomputed Atmospheric Scattering", 2008, and its 2017 revision). Our code is written in our own
words from the method, as these two MIT-licensed ports carry it:

- **pmndrs/sky** (<https://github.com/pmndrs/sky>), MIT License, Copyright (c) 2026 Dennis Smolek.
- **webgpu-sky-atmosphere** (<https://github.com/JolifantoBambla/webgpu-sky-atmosphere>), MIT License,
  Copyright (c) 2024 Lukas Herzberger.

Both are offered under the MIT License:

> Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated
> documentation files (the "Software"), to deal in the Software without restriction, including without limitation the
> rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit
> persons to whom the Software is furnished to do so, subject to the following conditions:
>
> The above copyright notice and this permission notice shall be included in all copies or substantial portions of the
> Software.
>
> THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE
> WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
> COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
> OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

The physical constants of Earth's air the record starts from (Rayleigh, Mie and ozone coefficients, scale heights) are
the ones Hillaire's paper publishes.
