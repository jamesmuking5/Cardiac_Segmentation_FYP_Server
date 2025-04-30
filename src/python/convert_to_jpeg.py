import sys
import os
import nibabel as nib
import matplotlib.pyplot as plt
import pydicom
import subprocess
import numpy as np
import tempfile


def convert_nifti_to_jpeg(input_file, output_dir, user_id, project_id):
    try:
        # Load the NIfTI file
        img = nib.load(input_file)

        # Get oriented data - convert to RAS+ orientation (standard radiological)
        # Get original orientation
        orig_ornt = nib.io_orientation(img.affine)
        # Get target orientation (RAS+: Right, Anterior, Superior)
        ras_ornt = nib.orientations.axcodes2ornt("RAS")
        # Get the transform between them
        ornt_transform = nib.orientations.ornt_transform(orig_ornt, ras_ornt)
        # Apply the transform
        reoriented_img = img.as_reoriented(ornt_transform)

        # Now get the data in correct orientation
        data = reoriented_img.get_fdata()

        os.makedirs(output_dir, exist_ok=True)
        total_slices = data.shape[2]
        total_frames = data.shape[3] if len(data.shape) == 4 else 0

        print(
            f"Processing NIfTI file: {input_file} with {total_slices} slices and {total_frames} frames."
        )

        # Save images with proper normalization for better contrast
        if len(data.shape) == 4:
            for frame_idx in range(data.shape[3]):
                for slice_idx in range(data.shape[2]):
                    slice_data = data[:, :, slice_idx, frame_idx]
                    # Normalize each slice for better visualization
                    slice_data = _normalize_slice(slice_data)
                    output_path = os.path.join(
                        output_dir,
                        f"{user_id}_{project_id}_{frame_idx}_{slice_idx}.jpg",
                    )
                    plt.imsave(output_path, slice_data, cmap="gray")
                print(f"Converted all {total_slices} slices for frame {frame_idx}.")
        else:
            for slice_idx in range(data.shape[2]):
                slice_data = data[:, :, slice_idx]
                slice_data = _normalize_slice(slice_data)
                output_path = os.path.join(
                    output_dir, f"{user_id}_{project_id}_0_{slice_idx}.jpg"
                )
                plt.imsave(output_path, slice_data, cmap="gray")
            print(f"Converted all {total_slices} slices (no frames).")
        print(
            f"Successfully converted NIfTI file: {input_file} to JPEGs in {output_dir}"
        )
    except Exception as e:
        print(f"Error converting NIfTI file {input_file}: {e}", file=sys.stderr)
        sys.exit(1)


def _normalize_slice(slice_data):
    """Normalize slice data for better visualization."""
    # Handle potential NaN or infinity values
    slice_data = np.nan_to_num(slice_data)
    # Get min and max, but skip extreme outliers
    if slice_data.size > 0:
        p_low, p_high = np.percentile(slice_data, [2, 98])
        slice_data = np.clip(slice_data, p_low, p_high)
        # Scale to 0-1 range
        min_val = np.min(slice_data)
        max_val = np.max(slice_data)
        if max_val > min_val:
            slice_data = (slice_data - min_val) / (max_val - min_val)
    return slice_data

def convert_dicom_to_jpeg(input_file, output_dir, user_id, project_id):
    try:
        ds = pydicom.dcmread(input_file)
        pixel_array = ds.pixel_array
        os.makedirs(output_dir, exist_ok=True)
        num_frames = pixel_array.shape[0] if len(pixel_array.shape) == 3 else 1

        print(f"Processing DICOM file: {input_file} with {num_frames} frames.")

        if len(pixel_array.shape) == 3:
            for frame_idx in range(pixel_array.shape[0]):
                slice_idx = frame_idx
                output_path = os.path.join(output_dir, f"{user_id}_{project_id}_{frame_idx}_{slice_idx}.jpg")
                plt.imsave(output_path, pixel_array[frame_idx], cmap='gray')
            print(f"Converted all {num_frames} frames to JPEGs.")
        else:
            output_path = os.path.join(output_dir, f"{user_id}_{project_id}_0_0.jpg")
            plt.imsave(output_path, pixel_array, cmap='gray')
            print("Converted single-frame DICOM to JPEG.")
        print(f"Successfully converted DICOM file: {input_file} to JPEGs in {output_dir}")
    except Exception as e:
        print(f"Error converting DICOM file {input_file}: {e}", file=sys.stderr)
        sys.exit(1)


def bundle_to_tar(output_dir, tar_file):
    try:
        # Create tar in a temporary location to avoid including it in the archive
        with tempfile.NamedTemporaryFile(suffix=".tar", delete=False) as temp_tar:
            temp_tar_path = temp_tar.name

        # Create the tar archive in the temp location
        subprocess.run(["tar", "-cf", temp_tar_path, "-C", output_dir, "."], check=True)

        # Move it to the final destination (which should be OUTSIDE the output_dir)
        if os.path.exists(tar_file):
            os.unlink(tar_file)
        os.rename(temp_tar_path, tar_file)

        print(f"Bundled files into {tar_file}")
        # Print the full path for the Node.js code to find
        print(f"TAR_FILE_PATH:{os.path.abspath(tar_file)}")
    except subprocess.CalledProcessError as e:
        print(f"Error creating tarball {tar_file}: {e}", file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        print(f"Unexpected error creating tarball: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    input_file = sys.argv[1]
    output_dir = sys.argv[2]
    tar_file = sys.argv[3]  # Path to the output .tar file
    user_id = sys.argv[4]  # User ID
    project_id = sys.argv[5]  # Project ID

    print(
        f"Starting conversion of {input_file} for user {user_id}, project {project_id}."
    )

    if input_file.endswith((".nii", ".nii.gz")):
        convert_nifti_to_jpeg(input_file, output_dir, user_id, project_id)
    elif input_file.endswith(".dcm"):
        convert_dicom_to_jpeg(input_file, output_dir, user_id, project_id)
    else:
        print("Unsupported file type.", file=sys.stderr)
        sys.exit(1)

    # Create tar file OUTSIDE the output directory to avoid recursion
    tar_file_base = f"{user_id}_{project_id}_jpegs.tar"
    parent_dir = os.path.dirname(output_dir)
    tar_file_path = os.path.join(parent_dir, tar_file_base)

    bundle_to_tar(output_dir, tar_file_path)
    print(f"Files converted and bundled into {tar_file_path}")
