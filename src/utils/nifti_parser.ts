// File: src/utils/nifti_parser.ts
// Description: Utility function to extract metadata from NIfTI files using a Python script. This is useful for handling medical imaging data in the NIfTI format.

import { execFile } from 'child_process';
import path from 'path';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

// Path to the Python script that extracts metadata
const PYTHON_SCRIPT = path.join(__dirname, '..', 'python', 'extract_metadata.py');

/**
 * Interface describing the structure of metadata extracted from a NIfTI file.
 */
export interface INiftiMetadata {
    datatype: string; // Data type of the image (e.g., float32, int16, etc.)
    dimensions: {
        width: number | null;   // Number of pixels in the x-direction
        height: number | null;  // Number of pixels in the y-direction
        slices: number | null;  // Number of slices in the z-direction (depth)
        frames: number | null;  // Number of time frames (for 4D imaging data)
    };
    voxelsize: {
        x: number | null; // Voxel size in the x-direction (mm)
        y: number | null; // Voxel size in the y-direction (mm)
        z: number | null; // Voxel size in the z-direction (mm)
        t: number | null; // Time resolution, if applicable (e.g., seconds per frame)
    };
}

/**
 * Calls a Python script to extract metadata from a NIfTI file.
 * This method uses Node's `child_process` to execute a Python script and parse the JSON output.
 *
 * @param niftiPath - The local or temporary file path to the NIfTI (.nii or .nii.gz) file.
 * @returns A Promise resolving to an object of type `INiftiMetadata`, containing image dimensions and voxel size.
 */
export async function extractNiftiMetadata(niftiPath: string): Promise<INiftiMetadata> {
    try {
        // Execute the Python script with the given NIfTI path
        const { stdout } = await execFileAsync('python', [PYTHON_SCRIPT, niftiPath]);
  
        // Parse and return the metadata JSON output from the Python script
        const parsed: INiftiMetadata = JSON.parse(stdout);
        return parsed;
  
    } catch (error: any) {
        // Log an error if metadata extraction fails
        console.error('Failed to extract NIfTI metadata:', error.message || error);
  
        // Return a fallback object with default values to ensure robustness
        return {
            datatype: 'unknown',
            dimensions: {
            width: null,
            height: null,
            slices: null,
            frames: null,
            },
            voxelsize: {
            x: null,
            y: null,
            z: null,
            t: null,
            },
        };
    }
  }