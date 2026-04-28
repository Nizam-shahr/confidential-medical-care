import { ethers } from "hardhat";

let signers: any;

export async function initSigners() {
  const all = await ethers.getSigners();
  signers = {
    owner:  all[0],
    donor1: all[1],
    donor2: all[2],
  };
}

export async function getSigners() {
  return signers;
}