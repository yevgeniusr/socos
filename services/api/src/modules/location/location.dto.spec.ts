import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { createApplicationValidationPipe } from "../../common/application-validation.pipe.js";
import {
  CreateLocationAliasDto,
  OwnTracksLocationDto,
  UpdateLocationAliasDto,
} from "./location.dto.js";

describe("OwnTracksLocationDto", () => {
  const nowSeconds = Math.floor(Date.now() / 1_000);

  it("accepts old queued locations and every supported optional field", async () => {
    const errors = await validateDto({
      _type: "location",
      tst: 1,
      lat: -90,
      lon: 180,
      acc: 0,
      alt: -12.5,
      vel: 0,
      cog: 359.9,
      batt: 100,
      t: "p",
      tid: "A1",
    });

    expect(errors).toHaveLength(0);
  });

  it.each([
    ["wrong type", { _type: "transition", tst: nowSeconds, lat: 1, lon: 2 }],
    ["fractional timestamp", { _type: "location", tst: 1.5, lat: 1, lon: 2 }],
    [
      "future timestamp",
      { _type: "location", tst: nowSeconds + 700, lat: 1, lon: 2 },
    ],
    ["latitude range", { _type: "location", tst: nowSeconds, lat: 91, lon: 2 }],
    [
      "longitude range",
      { _type: "location", tst: nowSeconds, lat: 1, lon: -181 },
    ],
    [
      "negative accuracy",
      { _type: "location", tst: nowSeconds, lat: 1, lon: 2, acc: -1 },
    ],
    [
      "negative velocity",
      { _type: "location", tst: nowSeconds, lat: 1, lon: 2, vel: -1 },
    ],
    [
      "course range",
      { _type: "location", tst: nowSeconds, lat: 1, lon: 2, cog: 360 },
    ],
    [
      "battery range",
      { _type: "location", tst: nowSeconds, lat: 1, lon: 2, batt: 101 },
    ],
    [
      "non-number latitude",
      { _type: "location", tst: nowSeconds, lat: "1", lon: 2 },
    ],
    [
      "non-finite longitude",
      { _type: "location", tst: nowSeconds, lat: 1, lon: Infinity },
    ],
  ])("rejects %s", async (_case, input) => {
    expect(await validateDto(input)).not.toHaveLength(0);
  });

  it.each([
    [
      "numeric string",
      { _type: "location", tst: nowSeconds, lat: "1", lon: 2 },
    ],
    [
      "optional null",
      { _type: "location", tst: nowSeconds, lat: 1, lon: 2, acc: null },
    ],
    [
      "trigger number",
      { _type: "location", tst: nowSeconds, lat: 1, lon: 2, t: 112 },
    ],
    [
      "tid number",
      { _type: "location", tst: nowSeconds, lat: 1, lon: 2, tid: 11 },
    ],
  ])(
    "rejects JSON type coercion for %s through the application pipe",
    async (_case, input) => {
      await expect(
        createApplicationValidationPipe().transform(input, {
          type: "body",
          metatype: OwnTracksLocationDto,
          data: "",
        })
      ).rejects.toThrow();
    }
  );
});

describe("location alias DTOs", () => {
  it("accepts bounded Unicode aliases and IANA time zones", async () => {
    expect(
      await validateDto(
        {
          alias: "  Cafe\u0301 District  ",
          city: "Synthetic City",
          countryCode: "AE",
          timeZone: "Asia/Dubai",
        },
        CreateLocationAliasDto
      )
    ).toHaveLength(0);
    expect(
      await validateDto({ city: "Updated City" }, UpdateLocationAliasDto)
    ).toHaveLength(0);
  });

  it.each([
    [
      "blank alias",
      { alias: "  ", city: "City", countryCode: "AE", timeZone: "UTC" },
    ],
    [
      "blank city",
      { alias: "Alias", city: "  ", countryCode: "AE", timeZone: "UTC" },
    ],
    [
      "country casing",
      { alias: "Alias", city: "City", countryCode: "ae", timeZone: "UTC" },
    ],
    [
      "invalid country",
      { alias: "Alias", city: "City", countryCode: "A1", timeZone: "UTC" },
    ],
    [
      "invalid time zone",
      {
        alias: "Alias",
        city: "City",
        countryCode: "AE",
        timeZone: "Mars/Olympus",
      },
    ],
  ])("rejects %s", async (_name, input) => {
    expect(await validateDto(input, CreateLocationAliasDto)).not.toHaveLength(
      0
    );
  });

  it("rejects explicit nulls in partial patches", async () => {
    expect(
      await validateDto({ alias: null }, UpdateLocationAliasDto)
    ).not.toHaveLength(0);
  });
});

async function validateDto(
  input: object,
  metatype: new () => object = OwnTracksLocationDto
) {
  return validate(plainToInstance(metatype, input));
}
