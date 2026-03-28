import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import { HttpError } from "../utils/http-error.js";

export function errorHandler(
  error: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
) {
  if (error instanceof ZodError) {
    res.status(400).json({
      success: false,
      error: "Invalid request parameters.",
      details: error.flatten(),
    });
    return;
  }

  if (error instanceof HttpError) {
    res.status(error.statusCode).json({
      success: false,
      error: error.message,
      details: error.details,
    });
    return;
  }

  const message = error instanceof Error ? error.message : "Unexpected server error.";
  console.error(`[GT_V2Report] ${req.method} ${req.originalUrl}`, error);
  res.status(500).json({
    success: false,
    error: message,
  });
}
