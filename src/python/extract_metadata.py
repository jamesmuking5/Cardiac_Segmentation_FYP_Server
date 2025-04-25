# File: src/python/extract_metadata.py
# Description: Extracts metadata from a NIfTI file, either locally or from a pre-signed S3 URL.

import nibabel as nib
import json
import tempfile
import os
import requests

def extract_nifti_metadata(nifti_path):
    """
    Extract metadata from a NIfTI file (.nii or .nii.gz).
    """
    img = nib.load(nifti_path) # Load NIfTI file using nibabel
    header = img.header # Access image header for metadata
    shape = img.shape # Get image dimensions
    zooms = header.get_zooms() # Get voxel sizes (spatial resolution)

    # Structure metadata into a readable dictionary
    metadata = {
        "datatype": str(img.get_data_dtype()),
        "dimensions": {
            "width": int(shape[0]) if len(shape) > 0 else None,
            "height": int(shape[1]) if len(shape) > 1 else None,
            "slices": int(shape[2]) if len(shape) > 2 else None,
            "frames": int(shape[3]) if len(shape) > 3 else None
        },
        "voxelsize": {
            "x": float(zooms[0]) if len(zooms) > 0 else None,
            "y": float(zooms[1]) if len(zooms) > 1 else None,
            "z": float(zooms[2]) if len(zooms) > 2 else None,
            "t": float(zooms[3]) if len(zooms) > 3 else None
        }
    }

    return metadata

def is_url(path):
    """
    Check if the input path is a URL (HTTP or HTTPS).
    """
    return path.startswith("http://") or path.startswith("https://")

def download_from_url_to_temp(url):
    """
    Download file from URL to a temporary location and return the temp path.
    """
    response = requests.get(url, stream=True) # Stream the content to avoid memory overload
    response.raise_for_status()               # Raise exception if download fails

    temp_file = tempfile.NamedTemporaryFile(delete=False)  # Create a temp file on disk
    for chunk in response.iter_content(chunk_size=8192):   # Write file in chunks
        temp_file.write(chunk)
    temp_file.close()

    return temp_file.name  # Return the file path to be used by nibabel

# Entry point: handles both local paths and pre-signed URLs
if __name__ == "__main__":
    import sys

    if len(sys.argv) != 2:
        print("Usage: python extract_metadata.py <path_to_nifti or pre-signed URL>")
        sys.exit(1)

    input_path = sys.argv[1]

    try:
        if is_url(input_path):
            # Download the file if it's a URL, then extract metadata
            temp_path = download_from_url_to_temp(input_path)
            extracted_metadata = extract_nifti_metadata(temp_path)
            os.remove(temp_path)  # Clean up the temp file after use
        else:
            # Use the local file path directly
            extracted_metadata = extract_nifti_metadata(input_path)

        # Output the metadata in JSON format
        print(json.dumps(extracted_metadata, indent=2))

    except Exception as e:
        print(f"Error: {str(e)}")
        sys.exit(1)
