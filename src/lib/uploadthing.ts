"use client";

import {
  generateReactHelpers,
  generateUploadButton,
  generateUploadDropzone,
} from "@uploadthing/react";

import { type UploadRouter } from "~/server/storage/router";

export const { uploadFiles, useUploadThing } =
  generateReactHelpers<UploadRouter>();
export const UploadButton = generateUploadButton<UploadRouter>();
export const UploadDropzone = generateUploadDropzone<UploadRouter>();
