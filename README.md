# Cardiac_Segmentation_FYP_Server
This is a Node.js + Express.js backend for the Cardiac Segmentation Software Project for Team 6's FYP.

## Early documentation
- To run the development server, use `npm run dev`.
- To build server for production, use `npm run build` and `npm start`.
  - When `npm run build` is run, the server will be built into the `dist` folder from .ts to .js. Use `./tsconfig.json` to configure the build process.
  - The production server will run from the `dist` folder by running `npm start`.
  - The `dist` folder will be ignored by git, so it will not be included in the repository. This is to ensure that the repository only contains the source code and not the built code.

